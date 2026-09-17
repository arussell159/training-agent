import { setTimeout as pause } from "node:timers/promises";
import { CoachError, boundedText } from "./github-coach-source.mjs";

export async function coachOpenAIRequest({
  fetchImpl = fetch,
  body,
  config,
  signal,
  onStatus = () => {},
  onToken = () => {},
  wait = (ms, signal) => pause(ms, undefined, { signal }),
}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openaiKey}`, "Content-Type": "application/json" },
      signal,
      redirect: "error",
      body: JSON.stringify(body),
    });
    if (response.ok) {
      if (!body.stream) return response;
      const reader = response.body?.getReader();
      if (!reader) throw new CoachError("OpenAI returned an empty stream.");
      const decoder = new TextDecoder();
      let buffer = "";
      let completed;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          if (!data || data === "[DONE]") continue;
          let event;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          if (event.type === "response.output_text.delta" && event.delta)
            onToken(event.delta);
          if (event.type === "response.completed") completed = event.response;
          if (event.type === "error") throw new CoachError("OpenAI could not complete this response.");
        }
        if (done) break;
      }
      if (!completed) throw new CoachError("OpenAI did not finish this response.");
      return new Response(JSON.stringify(completed), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    let code;
    if (response.status === 429) {
      try {
        code = JSON.parse(await boundedText(response, 30000, "OpenAI error")).error?.code;
      } catch {
        /* Never echo provider error bodies. */
      }
      const retry = response.headers.get("retry-after");
      const delay =
        retry === null
          ? 15000 * (attempt + 1)
          : Number.isFinite(Number(retry))
            ? Number(retry) * 1000
            : Date.parse(retry) - Date.now();
      if (
        code === "rate_limit_exceeded" &&
        attempt < 2 &&
        Number.isFinite(delay) &&
        delay >= 0 &&
        delay <= 60000
      ) {
        onStatus("OpenAI requested a short pause. Retrying automatically…");
        await wait(Math.max(1000, delay + 250), signal);
        continue;
      }
    }
    const hint =
      response.status === 401
        ? "Check OPENAI_API_KEY in the hosting environment."
        : code === "insufficient_quota"
          ? "Check your OpenAI API billing balance and project budget."
          : response.status === 429
            ? "The OpenAI rate limit is still in effect. Wait a minute, then try again."
            : [400, 404].includes(response.status)
              ? "Check that OPENAI_MODEL is available to your API project and supports Responses function calling."
              : "Try again after the OpenAI service recovers.";
    throw new CoachError(
      `OpenAI could not complete this request (HTTP ${response.status}). ${hint}`
    );
  }
}
