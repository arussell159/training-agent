import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { generateCoachResponse } from "./coach-response.mjs";
import { loadCoachingInstructions } from "./coaching-policy.mjs";
import { createSection11Adapter, section11Tools } from "./section-11-adapter.mjs";

const structuredRun = {
  steps: [
    {
      duration: 1800,
      intensity: "active",
      pace: { start: 1, end: 2, units: "pace_zone" },
      text: "Easy aerobic",
    },
  ],
  duration: 1800,
};
const structuredRide = {
  steps: [
    {
      duration: 3600,
      intensity: "active",
      power: { start: 1, end: 2, units: "power_zone" },
      text: "Easy endurance",
    },
  ],
  duration: 3600,
};

test("production policy is rebuilt from the untouched upstream agentic contract, protocol, and workout library", async () => {
  const policy = await loadCoachingInstructions("Create a threshold workout");
  const agentic = await fs.readFile(
    new URL("../vendor/section-11/PROJECT_INSTRUCTIONS_AGENTIC.md", import.meta.url),
    "utf8"
  );
  const protocol = await fs.readFile(
    new URL("../vendor/section-11/SECTION_11.md", import.meta.url),
    "utf8"
  );
  const workouts = await fs.readFile(
    new URL("../vendor/section-11/examples/workout-library/WORKOUT_REFERENCE.md", import.meta.url),
    "utf8"
  );
  assert.equal(policy, `${agentic}\n\n${protocol}\n\n${workouts}`);
  const concise = await loadCoachingInstructions("How am I doing?");
  assert.equal(concise, `${agentic}\n\n${protocol}`);
});
test("coach receives only official instructions and current training data, with no app action tools", async () => {
  const requests = [];
  const context = {
    section11_artifacts: {
      latest: { metadata: { last_updated: "2026-09-15" } },
      history: { daily_90d: [{ date: "2026-09-14" }] },
      intervals: { activities: [] },
      routes: { events: [] },
      ftp_history: { entries: [] },
      saved_workouts: { folders: [] },
    },
  };
  const result = await generateCoachResponse(
    { OPENAI_API_KEY: "test" },
    {
      guide: "Exact official upstream files",
      currentDate: "2026-09-15",
      context,
      memory: [{ content: "OLD POLICY" }],
      history: [],
      message: "Review today",
    },
    async (url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ output_text: "Specific coaching answer" }) };
    }
  );
  assert.equal(result, "Specific coaching answer");
  assert.equal(requests[0].instructions, "Exact official upstream files");
  assert.equal(requests[0].reasoning.effort, "high");
  assert.equal(Object.hasOwn(requests[0], "tools"), false);
  assert.doesNotMatch(
    JSON.stringify(requests),
    /OLD POLICY|Application transport|Personalize training answers/
  );
  assert.match(JSON.stringify(requests[0].input), /CURRENT_SECTION11_DATA_FILES/);
  assert.match(
    JSON.stringify(requests[0].input),
    /latest\.json|history\.json|saved_workouts\.json/
  );
});
test("coach reports truthful Section 11 processing stages without exposing hidden reasoning", async () => {
  const statuses = [];
  const result = await generateCoachResponse(
    { OPENAI_API_KEY: "test" },
    {
      guide: "Upstream policy",
      currentDate: "2026-09-16",
      context: {},
      history: [],
      message: "Review my durability",
      onStatus: (status) => statuses.push(status),
    },
    async () =>
      new Response(JSON.stringify({ output_text: "Section 11 answer" }), {
        headers: { "Content-Type": "application/json" },
      })
  );
  assert.equal(result, "Section 11 answer");
  assert.ok(
    statuses.some(
      (status) => status.message === "Applying the official Section 11 coaching protocol…"
    )
  );
  assert.ok(
    statuses.every((status) => !String(status.message).toLowerCase().includes("chain of thought"))
  );
});
test("coach forwards provider text deltas while they are generated", async () => {
  const deltas = [];
  const frames =
    [
      { type: "response.output_text.delta", delta: "Fast " },
      { type: "response.output_text.delta", delta: "answer" },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Fast answer" }],
        },
      },
      { type: "response.completed", response: { output: [] } },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("") + "data: [DONE]\n\n";
  const result = await generateCoachResponse(
    { OPENAI_API_KEY: "test" },
    {
      guide: "guide",
      currentDate: "2026-09-16",
      context: {},
      message: "hello",
      onDelta: (delta) => deltas.push(delta),
    },
    async () => new Response(frames, { headers: { "Content-Type": "text/event-stream" } })
  );
  assert.equal(result, "Fast answer");
  assert.deepEqual(deltas, ["Fast ", "answer"]);
});
test("coach treats response.completed as terminal without waiting for the provider connection to close", async () => {
  let cancelled = false;
  const frames = [
    { type: "response.output_text.delta", delta: "Persistent answer" },
    { type: "response.completed", response: { output: [] } },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames));
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await generateCoachResponse(
    { OPENAI_API_KEY: "test" },
    { guide: "guide", currentDate: "2026-09-16", context: {}, message: "hello", onDelta: () => {} },
    async () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
  );
  assert.equal(result, "Persistent answer");
  assert.equal(cancelled, true);
});
test("coach exposes the provider validation message on a 400", async () => {
  await assert.rejects(
    generateCoachResponse(
      { OPENAI_API_KEY: "test" },
      { guide: "guide", currentDate: "2026-09-16", context: {}, message: "hello" },
      async () =>
        new Response(JSON.stringify({ error: { message: "Invalid tool schema" } }), { status: 400 })
    ),
    /Invalid tool schema/
  );
});
test("workout page reviews can bypass tool loops when current context is already loaded", async () => {
  let request;
  const result = await generateCoachResponse(
    { OPENAI_API_KEY: "test" },
    {
      guide: "guide",
      currentDate: "2026-09-16",
      context: { planned: [{ id: "event:1" }] },
      message: "Review planned workout event:1",
      disableTools: true,
    },
    async (url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ output_text: "Ready to train." }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  );
  assert.equal(result, "Ready to train.");
  assert.equal(Object.hasOwn(request, "tools"), false);
  assert.equal(Object.hasOwn(request, "tool_choice"), false);
});
test("Section 11 tools expose live reads and controlled confirmed writes", () => {
  const tools = section11Tools();
  assert.equal(tools.length, 26);
  assert.ok(tools.find((tool) => tool.name === "getSection11Snapshot"));
  assert.ok(tools.find((tool) => tool.name === "getSection11Artifact"));
  assert.ok(tools.find((tool) => tool.name === "createWorkout"));
  assert.ok(tools.find((tool) => tool.name === "createWorkouts"));
  assert.ok(tools.find((tool) => tool.name === "updateAnnualPlan"));
  assert.equal(
    tools.some((tool) => tool.name === "createEvent" || tool.name === "updateWellness"),
    false
  );
});
test("ordinary ATP advice uses injected Supabase context without exposing unnecessary tools", () => {
  assert.deepEqual(section11Tools("What do you think about my ATP leading into December?"), []);
  const planTools = section11Tools("Modify my annual plan");
  assert.ok(planTools.some((tool) => tool.name === "updateAnnualPlan"));
  assert.equal(
    planTools.some((tool) => tool.name === "getAnnualPlans"),
    false
  );
  const update = planTools.find((tool) => tool.name === "updateAnnualPlan");
  assert.deepEqual(update.parameters.required, [
    "confirmed",
    "plan_id",
    "range_start",
    "range_end",
    "reason",
    "changes",
  ]);
  assert.deepEqual(update.parameters.properties.changes.items.required, [
    "week_id",
    "phase",
    "target_hours",
    "notes",
  ]);
  assert.ok(
    section11Tools("Review my completed activity").some((tool) => tool.name === "getActivity")
  );
  assert.ok(
    section11Tools("Review my durability and TID").some(
      (tool) => tool.name === "getSection11Artifact"
    )
  );
  assert.deepEqual(
    section11Tools("Plan a run workout").find((tool) => tool.name === "createWorkout").parameters
      .properties.workout.required,
    ["date", "type", "name", "moving_time", "description", "workout_doc"]
  );
  const weeklyTools = section11Tools("Make a week's worth of workouts");
  assert.equal(
    weeklyTools.some((tool) => tool.name === "createWorkout"),
    false
  );
  assert.equal(
    weeklyTools.find((tool) => tool.name === "createWorkouts").parameters.properties.workouts
      .minItems,
    2
  );
});
test("the separate workout formatter can ask one question instead of forcing a preview", async () => {
  let request;
  const result = await generateCoachResponse(
    { OPENAI_API_KEY: "test" },
    {
      guide: "",
      currentDate: "2026-09-16",
      context: {},
      message: "Create structured workouts from this feedback",
      actionMode: "workouts",
      sourceFeedback: "Add aerobic work next week.",
    },
    async (url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ output_text: "Which day should I schedule it?" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  );
  assert.equal(result, "Which day should I schedule it?");
  assert.equal(request.tool_choice, "auto");
});
test("normal coach follow-ups never receive write tools while the separate formatter does", async () => {
  let request;
  await generateCoachResponse(
    { OPENAI_API_KEY: "test" },
    {
      guide: "official",
      currentDate: "2026-09-16",
      context: {},
      history: [{ role: "assistant", content: "Add an endurance ride." }],
      message: "Tomorrow",
    },
    async (url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ output_text: "Thanks." }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  );
  assert.equal(Object.hasOwn(request, "tools"), false);
  await generateCoachResponse(
    { OPENAI_API_KEY: "test" },
    {
      guide: "",
      currentDate: "2026-09-16",
      context: {},
      message: "Create structured workouts from this feedback",
      actionMode: "workouts",
      sourceFeedback: "Add an endurance ride.",
    },
    async (url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ output_text: "Which day?" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  );
  assert.ok(request.tools.some((tool) => tool.name === "createWorkout"));
  assert.ok(request.tools.some((tool) => tool.name === "createWorkouts"));
  await generateCoachResponse(
    { OPENAI_API_KEY: "test" },
    {
      guide: "",
      currentDate: "2026-09-16",
      context: {},
      message: "Update my annual training plan from this feedback",
      actionMode: "annual_plan",
      sourceFeedback: "Make next week a recovery week.",
    },
    async (url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ output_text: "Which plan?" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  );
  assert.deepEqual(
    request.tools.map((tool) => tool.name),
    ["updateAnnualPlan"]
  );
});
test("write requests expose one approval preview and retain the full Section 11 response", async () => {
  let requests = 0,
    preview;
  assert.ok(section11Tools("Plan a run workout").some((tool) => tool.name === "createWorkout"));
  const executeTool = createSection11Adapter({
    userMessage: "Plan a run workout",
    onPreview: (value) => {
      preview = value;
    },
  });
  const result = await generateCoachResponse(
    { OPENAI_API_KEY: "test" },
    {
      guide: "",
      currentDate: "2026-09-16",
      context: {},
      message: "Create structured workouts from this feedback",
      actionMode: "workouts",
      sourceFeedback: "Plan a run workout",
      executeTool,
    },
    async () => {
      requests++;
      return new Response(
        JSON.stringify(
          requests === 1
            ? {
                output: [
                  {
                    type: "function_call",
                    call_id: "call1",
                    name: "createWorkout",
                    arguments: JSON.stringify({
                      confirmed: false,
                      workout: {
                        date: "2026-09-18",
                        type: "Run",
                        name: "Easy Run",
                        moving_time: 1800,
                        description: "30 minutes easy",
                        workout_doc: structuredRun,
                      },
                    }),
                  },
                ],
              }
            : {
                output_text:
                  "Full Section 11 rationale, readiness context, prescription, execution guidance, and caveats.",
              }
        ),
        { headers: { "Content-Type": "application/json" } }
      );
    }
  );
  assert.equal(requests, 2);
  assert.equal(preview.operation, "create_workout");
  assert.match(result, /Full Section 11 rationale/);
});
test("a weekly request produces one complete batch preview and one approval decision", async () => {
  let preview,
    requests = 0;
  const workouts = [
    {
      date: "2026-10-05",
      type: "Swim",
      name: "Swim Aerobic Technique",
      moving_time: 1800,
      description: "Structured swim",
      workout_doc: structuredRun,
    },
    {
      date: "2026-10-06",
      type: "Ride",
      name: "Bike Aerobic Endurance",
      moving_time: 3600,
      description: "Structured bike",
      workout_doc: structuredRide,
    },
  ];
  const executeTool = createSection11Adapter({
    userMessage: "Make a week's worth of workouts",
    onPreview: (value) => {
      preview = value;
    },
  });
  const result = await generateCoachResponse(
    { OPENAI_API_KEY: "test" },
    {
      guide: "",
      currentDate: "2026-09-16",
      context: {},
      message: "Create structured workouts from this feedback",
      actionMode: "workouts",
      sourceFeedback: "Make a week's worth of workouts",
      executeTool,
    },
    async () => {
      requests++;
      return new Response(
        JSON.stringify(
          requests === 1
            ? {
                output: [
                  {
                    type: "function_call",
                    call_id: "batch1",
                    name: "createWorkouts",
                    arguments: JSON.stringify({
                      confirmed: false,
                      reason: "Complete week",
                      workouts,
                    }),
                  },
                ],
              }
            : {
                output_text:
                  "Full Section 11 weekly analysis with the purpose, progression, execution details, and recovery context for every session.",
              }
        ),
        { headers: { "Content-Type": "application/json" } }
      );
    }
  );
  assert.equal(requests, 2);
  assert.equal(preview.operation, "create_workouts");
  assert.equal(preview.workouts.length, 2);
  assert.match(result, /Full Section 11 weekly analysis/);
});
test("coach writes require preview and explicit confirmation", async () => {
  let writes = 0;
  const workout = {
    date: "2026-09-17",
    type: "Ride",
    name: "Endurance Ride",
    moving_time: 3600,
    description: "Easy endurance",
    workout_doc: structuredRide,
  };
  const preview = createSection11Adapter({
    userMessage: "Create this workout",
    createWorkout: async () => {
      writes++;
      return { id: 1 };
    },
  });
  assert.equal((await preview("createWorkout", { confirmed: false, workout })).status, "preview");
  assert.equal(
    (await preview("createWorkout", { confirmed: true, workout })).status,
    "confirmation_required"
  );
  assert.equal(writes, 0);
  const confirmed = createSection11Adapter({
    userMessage: "Yes, create it",
    createWorkout: async () => {
      writes++;
      return { id: 1 };
    },
  });
  assert.equal((await confirmed("createWorkout", { confirmed: true, workout })).verified, true);
  assert.equal(writes, 1);
});
test("one batch approval creates every workout and rejects a one-workout batch", async () => {
  const workouts = [
    {
      date: "2026-10-05",
      type: "Swim",
      name: "Swim Aerobic Technique",
      moving_time: 1800,
      description: "Structured swim",
      workout_doc: structuredRun,
    },
    {
      date: "2026-10-06",
      type: "Ride",
      name: "Bike Aerobic Endurance",
      moving_time: 3600,
      description: "Structured bike",
      workout_doc: structuredRide,
    },
  ];
  let writes = 0;
  const preview = createSection11Adapter({ userMessage: "Make a week's worth of workouts" });
  assert.equal(
    (await preview("createWorkouts", { confirmed: false, reason: "Complete week", workouts }))
      .status,
    "preview"
  );
  await assert.rejects(
    preview("createWorkouts", {
      confirmed: false,
      reason: "Incomplete",
      workouts: workouts.slice(0, 1),
    }),
    /complete batch/
  );
  const confirmed = createSection11Adapter({
    userMessage: "Yes, create it",
    createWorkout: async (workout) => ({ id: ++writes, name: workout.name }),
  });
  const result = await confirmed("createWorkouts", {
    confirmed: true,
    reason: "Complete week",
    workouts,
  });
  assert.equal(result.verified, true);
  assert.equal(result.events.length, 2);
  assert.equal(writes, 2);
});
test("chat mode never writes directly even if the model marks a tool call confirmed", async () => {
  let writes = 0,
    preview;
  const adapter = createSection11Adapter({
    userMessage: "Yes, create it",
    allowConfirmedWrites: false,
    onPreview: (value) => {
      preview = value;
    },
    createWorkout: async () => {
      writes++;
      return { id: 1 };
    },
  });
  const result = await adapter("createWorkout", {
    confirmed: true,
    workout: {
      date: "2026-09-18",
      type: "Run",
      name: "Easy Run",
      moving_time: 1800,
      description: "Easy",
      workout_doc: structuredRun,
    },
  });
  assert.equal(result.status, "preview");
  assert.equal(preview.operation, "create_workout");
  assert.equal(writes, 0);
});
test("coach rejects an unstructured workout before showing approval", async () => {
  const adapter = createSection11Adapter({ userMessage: "Plan a run workout" });
  await assert.rejects(
    adapter("createWorkout", {
      confirmed: false,
      workout: {
        date: "2026-09-18",
        type: "Run",
        name: "Easy Run",
        moving_time: 1800,
        description: "Easy",
      },
    }),
    /complete Intervals\.icu workout_doc/
  );
});
test("coach asks before duplicating a planned day but allows Section 11 recovery deviations", async () => {
  const duplicate = createSection11Adapter({
    userMessage: "Plan my Thursday workout",
    context: { planned: [{ workout_date: "2026-09-17", title: "Threshold Run" }] },
  });
  await assert.rejects(
    duplicate("createWorkout", {
      confirmed: false,
      workout: {
        date: "2026-09-17",
        type: "Swim",
        name: "Technique Swim",
        moving_time: 1800,
        description: "Easy",
        workout_doc: structuredRun,
      },
    }),
    /already planned/
  );
  const preference = createSection11Adapter({
    userMessage: "Plan Monday for me",
    context: { planned: [], training_preferences: { weekly_schedule: { monday: "Swim" } } },
  });
  assert.equal(
    (
      await preference("createWorkout", {
        confirmed: false,
        workout: {
          date: "2026-09-21",
          type: "Run",
          name: "Easy Run",
          moving_time: 1800,
          description: "Easy",
          workout_doc: structuredRun,
        },
      })
    ).status,
    "preview"
  );
});
test("the action wrapper preserves Section 11 names and descriptions exactly", async () => {
  const common = "Use the plan pace ranges, not faster targets.";
  const context = {
    planned: [],
    training_preferences: {
      workout_format: {
        enabled: true,
        title_prefixes: { run: ["Run", "Brick Run"] },
        description_sections: ["Warm Up", "Main Set", "Warm Down"],
        common_descriptions: { run: common },
      },
    },
  };
  const adapter = createSection11Adapter({ userMessage: "Plan a run workout on Friday", context });
  const workout = {
    date: "2026-09-18",
    type: "Run",
    name: "Run 4x5min Threshold",
    moving_time: 1800,
    description: `Warm Up:\nEasy\n\nMain Set:\n4 x 5 min\n\nWarm Down:\nEasy\n\n${common}`,
    workout_doc: structuredRun,
  };
  assert.equal((await adapter("createWorkout", { confirmed: false, workout })).status, "preview");
  const normalized = await adapter("createWorkout", {
    confirmed: false,
    workout: { ...workout, name: "Threshold Intervals", description: "30 minutes easy" },
  });
  assert.equal(normalized.workout.name, "Threshold Intervals");
  assert.equal(normalized.workout.description, "30 minutes easy");
});
test("annual plan changes use the same preview and confirmation gate", async () => {
  let writes = 0;
  const args = {
    confirmed: false,
    plan_id: "plan-1",
    reason: "Move recovery earlier",
    changes: [{ week_id: "2026-10-05", recovery: true }],
  };
  const preview = createSection11Adapter({
    userMessage: "Move recovery earlier",
    updateAnnualPlan: async () => {
      writes++;
      return { id: "plan-1" };
    },
  });
  assert.equal((await preview("updateAnnualPlan", args)).status, "preview");
  assert.equal(writes, 0);
  const confirmed = createSection11Adapter({
    userMessage: "Go ahead",
    updateAnnualPlan: async () => {
      writes++;
      return { id: "plan-1" };
    },
  });
  assert.equal((await confirmed("updateAnnualPlan", { ...args, confirmed: true })).verified, true);
  assert.equal(writes, 1);
});
test("Section 11 snapshot includes athlete comments but excludes application coaching preferences", async () => {
  const read = createSection11Adapter({
    currentDate: "2026-09-16",
    context: {
      training_preferences: {
        weekly_schedule: { monday: "Swim" },
        workout_format: { title_pattern: "Do not send to coach" },
      },
      comments: [{ workout_id: "activity:1", body: "Felt controlled" }],
      history: [
        {
          id: "activity:1",
          workout_date: "2026-09-15",
          raw: { large: "provider payload" },
          raw_activity: { streams: [1, 2, 3] },
        },
      ],
    },
  });
  const snapshot = await read("getSection11Snapshot");
  assert.equal(snapshot.athlete_comments[0].body, "Felt controlled");
  assert.equal(snapshot.recent_activities[0].raw, undefined);
  assert.equal(snapshot.recent_activities[0].raw_activity, undefined);
  assert.equal(snapshot.training_preferences, undefined);
});
test("unconnected reads and unsupported writes do not fabricate or apply data", async () => {
  const read = createSection11Adapter({ currentDate: "2026-09-16" });
  assert.match((await read("getAthlete")).unavailable, /Connect Intervals/);
  assert.match(
    (await read("createEvent", { body: { name: "Ride" } })).unavailable,
    /Unknown read operation/
  );
  assert.equal((await read("getSection11Snapshot")).schema, "section-11-live-adapter/v1");
});
