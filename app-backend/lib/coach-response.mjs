import {
  section11Snapshot,
  section11Tools,
  createSection11Adapter,
} from "./section-11-adapter.mjs";

const ACTION_FORMATTER_INSTRUCTIONS = `You are an application-side formatter, not the Section 11 coach.
Convert only the supplied SOURCE_SECTION_11_FEEDBACK into the requested application change.
Do not add, remove, reinterpret, or override any coaching recommendation.
For workouts, create complete structured Intervals.icu workout_doc objects. For an annual-plan change, update only the weeks supported by the feedback.
If the feedback does not contain enough information to perform the requested conversion faithfully, ask one concise clarification question instead of making a coaching decision.
Always call the applicable preview tool with confirmed=false. The application handles approval and execution separately.`;

function providerError(status, body) {
  try {
    const parsed = JSON.parse(body),
      message = String(parsed?.error?.message || "")
        .replace(/\s+/g, " ")
        .slice(0, 400);
    return new Error(`OpenAI request failed (${status})${message ? `: ${message}` : ""}`);
  } catch {
    return new Error(`OpenAI request failed (${status})`);
  }
}

async function streamedResponse(response, onDelta) {
  if (!response.body) throw new Error("OpenAI returned an empty response stream");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    text = "",
    completed = null,
    terminal = false;
  const items = [];
  const accept = (frame) => {
    const payload = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!payload || payload === "[DONE]") return;
    const event = JSON.parse(payload);
    if (event.type === "response.output_text.delta" && event.delta) {
      text += event.delta;
      onDelta(event.delta);
    }
    if (event.type === "response.output_item.done" && event.item)
      items[event.output_index ?? items.length] = event.item;
    if (event.type === "response.completed") {
      completed = event.response;
      terminal = true;
    }
    if (
      event.type === "error" ||
      event.type === "response.failed" ||
      event.type === "response.incomplete"
    )
      throw new Error(
        event.message || event.response?.error?.message || "OpenAI streaming response failed"
      );
  };
  while (!terminal) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) {
      accept(frame);
      if (terminal) break;
    }
  }
  if (terminal) await reader.cancel().catch(() => {});
  else {
    buffer += decoder.decode();
    if (buffer.trim()) accept(buffer);
  }
  return {
    ...(completed || {}),
    output: completed?.output?.length ? completed.output : items.filter(Boolean),
    output_text: text || completed?.output_text || "",
  };
}

function toolStatus(name) {
  if (name === "createWorkout" || name === "createWorkouts")
    return "Structuring the workout proposal for Intervals.icu…";
  if (name === "updateAnnualPlan") return "Structuring the annual training plan proposal…";
  if (name === "getAnnualPlans") return "Checking the annual training plan…";
  if (name === "getSection11Snapshot") return "Checking the current Section 11 training snapshot…";
  if (name === "getSection11Artifact") return "Checking an official Section 11 metric artifact…";
  return "Checking additional Intervals.icu data…";
}

function officialCoachData(context, currentDate) {
  const artifacts = context?.section11_artifacts || {};
  if (artifacts.latest)
    return {
      "latest.json": artifacts.latest,
      "history.json": artifacts.history || null,
      "intervals.json": artifacts.intervals || null,
      "routes.json": artifacts.routes || null,
      "ftp_history.json": artifacts.ftp_history || null,
      "saved_workouts.json": artifacts.saved_workouts || null,
      "application_annual_plans.json": context.annual_plans || [],
    };
  return { "latest.json": section11Snapshot(context, currentDate) };
}

export async function generateCoachResponse(
  config,
  {
    guide,
    currentDate,
    context,
    history = [],
    message,
    executeTool,
    onDelta,
    onStatus,
    actionMode = null,
    sourceFeedback = "",
  },
  fetchImpl = fetch
) {
  const actionContext = [
    ...history.slice(-4).map((item) => String(item.content || "")),
    message,
  ].join("\n");
  const tools =
    actionMode === "workouts"
      ? section11Tools().filter(
          (tool) => tool.name === "createWorkout" || tool.name === "createWorkouts"
        )
      : actionMode === "annual_plan"
        ? section11Tools().filter((tool) => tool.name === "updateAnnualPlan")
        : [];
  const writeTool = tools.find(
    (tool) =>
      tool.name === "createWorkout" ||
      tool.name === "createWorkouts" ||
      tool.name === "updateAnnualPlan"
  );
  const runTool = executeTool || createSection11Adapter({ context, currentDate });
  const input = actionMode
    ? [
        {
          role: "developer",
          content: `CURRENT_SECTION11_SNAPSHOT\n${JSON.stringify(section11Snapshot(context, currentDate))}`,
        },
        {
          role: "user",
          content: `SOURCE_SECTION_11_FEEDBACK\n${String(sourceFeedback || "").trim()}\n\nREQUESTED_APPLICATION_ACTION\n${message}`,
        },
      ]
    : [
        {
          role: "developer",
          content: `CURRENT_SECTION11_DATA_FILES\n${JSON.stringify(officialCoachData(context, currentDate))}`,
        },
        ...history
          .filter((item) => ["user", "assistant"].includes(item.role))
          .map((item) => ({ role: item.role, content: String(item.content || "") })),
        { role: "user", content: message },
      ];
  let calls = 0;
  let pendingActionPreview = null;
  const batchWrite = writeTool?.name === "createWorkouts";
  const deadline = Date.now() + (batchWrite ? 240_000 : writeTool ? 180_000 : 120_000),
    seenCalls = new Map();
  for (let round = 0; round < 8; round++) {
    onStatus?.({
      message: actionMode
        ? pendingActionPreview
          ? "Preparing the application preview…"
          : round
            ? "Finishing the structured application change…"
            : "Converting the Section 11 feedback into a structured change…"
        : "Applying the official Section 11 coaching protocol…",
      progress: pendingActionPreview
        ? 92
        : actionMode
          ? Math.min(72 + round * 8, 88)
          : Math.min(68 + round * 4, 88),
    });
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new Error(
        "The coach timed out while gathering current training data. Please try again."
      );
    let response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(
          Math.min(batchWrite ? 180_000 : writeTool ? 150_000 : 90_000, remaining)
        ),
        body: JSON.stringify({
          model: config.OPENAI_MODEL || "gpt-5-mini",
          store: false,
          stream: Boolean(onDelta),
          ...(onDelta ? { stream_options: { include_obfuscation: false } } : {}),
          truncation: "auto",
          max_output_tokens: batchWrite ? 12_000 : 8000,
          reasoning: { effort: "high" },
          prompt_cache_key: actionMode
            ? "section-11-action-formatter"
            : "section-11-coach-upstream",
          instructions: actionMode ? ACTION_FORMATTER_INSTRUCTIONS : guide,
          input,
          ...(!pendingActionPreview && tools.length
            ? { tools, tool_choice: calls >= 8 ? "none" : "auto" }
            : {}),
        }),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError")
        throw new Error("The coach provider timed out. Please try again.");
      throw error;
    }
    if (!response.ok) throw providerError(response.status, await response.text());
    const data = onDelta ? await streamedResponse(response, onDelta) : await response.json();
    const output = data.output || [];
    const requests = output.filter((item) => item.type === "function_call");
    if (!requests.length) {
      const text =
        data.output_text ||
        output
          .flatMap((item) => item.content || [])
          .filter((item) => item.type === "output_text")
          .map((item) => item.text)
          .join("\n");
      if (!text?.trim()) throw new Error("OpenAI returned an empty coach response");
      return text;
    }
    input.push(...output);
    let actionPreview = null;
    for (const request of requests) {
      let result;
      onStatus?.({ message: toolStatus(request.name), progress: Math.min(74 + calls * 3, 89) });
      const args = JSON.parse(request.arguments || "{}"),
        signature = `${request.name}:${JSON.stringify(args)}`,
        seen = (seenCalls.get(signature) || 0) + 1;
      seenCalls.set(signature, seen);
      try {
        result =
          seen > 1
            ? {
                error:
                  "This exact tool result is already present. Answer using the retrieved data.",
              }
            : ++calls > 8
              ? { error: "Read budget reached. Answer using retrieved data." }
              : await runTool(request.name, args);
      } catch (error) {
        result =
          writeTool && request.name === writeTool.name
            ? {
                error: error instanceof Error ? error.message : "The action preview is incomplete.",
              }
            : {
                error:
                  "Intervals.icu read failed. Requested data is unavailable; do not invent it.",
              };
      }
      if (result?.status === "preview" && result?.requires_confirmation) actionPreview = result;
      input.push({
        type: "function_call_output",
        call_id: request.call_id,
        output: JSON.stringify(result),
      });
    }
    if (actionPreview) pendingActionPreview = actionPreview;
  }
  throw new Error("The coach repeated too many data lookups. Please try the request again.");
}
