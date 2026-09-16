import { section11CoachView } from "./section-11-sync.mjs";

const READ_OPERATIONS = [
  ["getAthlete", "/athlete/0", []],
  ["getAthleteProfile", "/athlete/0/profile", []],
  ["getTrainingPlan", "/athlete/0/training-plan", []],
  ["listSportSettings", "/athlete/0/sport-settings", []],
  ["getSportSettings", "/athlete/0/sport-settings/{id}", [["id", "path", true]]],
  [
    "listActivities",
    "/athlete/0/activities",
    [
      ["oldest", "query"],
      ["newest", "query"],
      ["limit", "query"],
      ["fields", "query"],
    ],
  ],
  [
    "getActivity",
    "/activity/{id}",
    [
      ["id", "path", true],
      ["intervals", "query"],
    ],
  ],
  ["getActivityIntervals", "/activity/{id}/intervals", [["id", "path", true]]],
  [
    "listWellness",
    "/athlete/0/wellness",
    [
      ["oldest", "query"],
      ["newest", "query"],
      ["fields", "query"],
    ],
  ],
  ["getWellnessForDate", "/athlete/0/wellness/{date}", [["date", "path", true]]],
  [
    "listEvents",
    "/athlete/0/events",
    [
      ["oldest", "query"],
      ["newest", "query"],
    ],
  ],
  ["getEvent", "/athlete/0/events/{eventId}", [["eventId", "path", true]]],
  [
    "getPowerCurves",
    "/athlete/0/power-curves.json",
    [
      ["type", "query"],
      ["curves", "query"],
      ["newest", "query"],
    ],
  ],
  [
    "getPaceCurves",
    "/athlete/0/pace-curves.json",
    [
      ["type", "query"],
      ["curves", "query"],
      ["newest", "query"],
    ],
  ],
  [
    "getHRCurves",
    "/athlete/0/hr-curves.json",
    [
      ["type", "query"],
      ["curves", "query"],
    ],
  ],
  [
    "getPowerHRCurve",
    "/athlete/0/power-hr-curve",
    [
      ["start", "query"],
      ["end", "query"],
    ],
  ],
  ["listRoutes", "/athlete/0/routes", []],
  ["getWeatherForecast", "/athlete/0/weather-forecast", []],
  ["listWorkouts", "/athlete/0/workouts", []],
  ["listFolders", "/athlete/0/folders", []],
];

const DATE_FIELDS = new Set(["oldest", "newest", "date", "start", "end"]);

function compactWorkout(workout) {
  if (!workout || typeof workout !== "object") return workout;
  const { raw, raw_activity, analysis, route, streams, fit_bytes, ...summary } = workout;
  return summary;
}

export function section11Snapshot(context = {}, currentDate) {
  const protocolMetrics = section11CoachView(context.section11_artifacts);
  const recentStart = new Date(`${currentDate}T12:00:00Z`);
  recentStart.setUTCDate(recentStart.getUTCDate() - 28);
  const recentDate = recentStart.toISOString().slice(0, 10);
  const upcomingEnd = new Date(`${currentDate}T12:00:00Z`);
  upcomingEnd.setUTCDate(upcomingEnd.getUTCDate() + 28);
  const upcomingDate = upcomingEnd.toISOString().slice(0, 10);
  const history = (context.history || context.workouts || [])
    .filter(
      (item) =>
        String(item.workout_date || "") >= recentDate &&
        String(item.workout_date || "") <= currentDate
    )
    .map(compactWorkout);
  const planned = (context.planned || [])
    .filter(
      (item) =>
        String(item.workout_date || "") >= currentDate &&
        String(item.workout_date || "") <= upcomingDate
    )
    .map(compactWorkout);

  return {
    schema: "section-11-live-adapter/v1",
    authoritative_section11_labels: protocolMetrics
      ? {
          readiness_recommendation: protocolMetrics.readiness_decision?.recommendation ?? null,
          detected_phase: protocolMetrics.phase_detection?.phase ?? null,
        }
      : null,
    metadata: {
      current_date: currentDate,
      source: context.source || "intervals",
      last_updated: context.synced_at || null,
      freshness: context.synced_at ? "live_application_sync" : "unknown",
    },
    current_status: {
      athlete_profile: context.athlete || null,
      thresholds: context.athlete?.thresholds || context.athlete?.sport_settings || null,
      load: context.metrics || null,
      wellness: context.wellness || null,
    },
    recent_activities: history,
    planned_workouts: planned,
    wellness_history: (context.wellness_history || []).filter(
      (item) => String(item.date || item.id || "") >= recentDate
    ),
    performance_history: (context.performance || []).filter(
      (item) => String(item.workoutDay || item.date || "") >= recentDate
    ),
    athlete_comments: (context.comments || []).slice(0, 50),
    annual_training_plans: (context.annual_plans || []).map(({ revisionHistory, ...plan }) => plan),
    section11_metrics: protocolMetrics,
    availability: {
      live_intervals_reads: true,
      protocol: "Section 11",
      dossier: "not_configured",
      section11_sync_artifacts: Boolean(protocolMetrics),
      unavailable_from_intervals: protocolMetrics?.missing_inputs || [],
    },
  };
}

function parametersFor(parameters) {
  const properties = Object.fromEntries(
    parameters.map(([name]) => [
      name,
      DATE_FIELDS.has(name)
        ? { type: "string", description: "ISO date (YYYY-MM-DD)" }
        : name === "limit"
          ? { type: "integer" }
          : name === "intervals"
            ? { type: "boolean" }
            : { type: "string" },
    ])
  );
  return {
    type: "object",
    properties,
    required: parameters.filter(([, , required]) => required).map(([name]) => name),
    additionalProperties: false,
  };
}

export function section11Tools(message = null) {
  const workoutSchema = {
    type: "object",
    additionalProperties: false,
    required: ["date", "type", "name", "moving_time", "description", "workout_doc"],
    properties: {
      date: { type: "string", description: "YYYY-MM-DD" },
      type: {
        type: "string",
        enum: ["Ride", "VirtualRide", "Run", "Swim", "WeightTraining", "Workout"],
      },
      name: { type: "string" },
      moving_time: { type: "integer", description: "Total seconds" },
      description: { type: "string" },
      load_target: { type: "number" },
      workout_doc: {
        type: "object",
        additionalProperties: true,
        required: ["steps"],
        properties: {
          steps: {
            type: "array",
            minItems: 1,
            items: { type: "object", additionalProperties: true },
          },
          duration: { type: "number" },
        },
      },
      external_id: { type: "string" },
    },
  };
  const all = [
    {
      type: "function",
      name: "getSection11Snapshot",
      description:
        "Read the current live athlete, load, wellness, recent activity, and planned workout snapshot used by the Section 11 coach. Call this before current coaching advice.",
      strict: true,
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
    {
      type: "function",
      name: "getAnnualPlans",
      strict: true,
      description:
        "Read the saved annual training plans and their current periodization weeks before proposing a plan change.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
    {
      type: "function",
      name: "getSection11Artifact",
      strict: false,
      description:
        "Read an official Section 11 artifact derived directly from Intervals.icu. Use intervals for detailed completed-session analysis, routes for terrain, and history for longer-term trends.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["artifact"],
        properties: {
          artifact: {
            type: "string",
            enum: ["latest", "history", "intervals", "routes", "ftp_history"],
          },
          id: {
            type: "string",
            description: "Optional activity or event ID used to return only the matching record.",
          },
        },
      },
    },
    {
      type: "function",
      name: "createWorkout",
      strict: false,
      description:
        "Preview or, after the athlete explicitly confirms the displayed preview, create and verify one planned workout in Intervals.icu.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["confirmed", "workout"],
        properties: {
          confirmed: {
            type: "boolean",
            enum: [false],
            description: "Always false in coach chat. The application handles approval separately.",
          },
          workout: workoutSchema,
        },
      },
    },
    {
      type: "function",
      name: "createWorkouts",
      strict: false,
      description:
        "Preview a complete multi-day set of fully structured workouts and create all of them in Intervals.icu after one application approval.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["confirmed", "reason", "workouts"],
        properties: {
          confirmed: {
            type: "boolean",
            enum: [false],
            description:
              "Always false in coach chat. The application handles one approval for the complete batch.",
          },
          reason: {
            type: "string",
            description:
              "Brief explanation of how the complete batch fits the athlete and current plan.",
          },
          workouts: { type: "array", minItems: 2, maxItems: 14, items: workoutSchema },
        },
      },
    },
    {
      type: "function",
      name: "updateAnnualPlan",
      strict: false,
      description:
        "Preview or, after explicit athlete confirmation, apply and save periodization changes to specific weeks in an existing annual plan.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["confirmed", "plan_id", "range_start", "range_end", "reason", "changes"],
        properties: {
          confirmed: { type: "boolean", enum: [false] },
          plan_id: { type: "string" },
          range_start: { type: "string", description: "First affected calendar date, YYYY-MM-DD" },
          range_end: { type: "string", description: "Last affected calendar date, YYYY-MM-DD" },
          reason: { type: "string" },
          changes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["week_id", "phase", "target_hours", "notes"],
              properties: {
                week_id: { type: "string" },
                phase: {
                  type: "string",
                  enum: [
                    "Not Set",
                    "Preparation",
                    "Base 1",
                    "Base 2",
                    "Base 3",
                    "Build 1",
                    "Build 2",
                    "Peak",
                    "Race",
                    "Transition",
                  ],
                },
                target_hours: { type: "number" },
                notes: {
                  type: "string",
                  description:
                    "One concise sentence for the week Details section that can guide later workout planning.",
                },
              },
            },
          },
        },
      },
    },
    ...READ_OPERATIONS.map(([name, , parameters]) => ({
      type: "function",
      name,
      description: `Read ${name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} from the authenticated athlete's Intervals.icu account. Read-only.`,
      strict: false,
      parameters: parametersFor(parameters),
    })),
  ];
  if (message == null) return all;
  const query = String(message).toLowerCase();
  const workoutWrite =
    /\b(create|add|schedule|save|build|plan|make|write)\b.*\b(workouts?|sessions?|rides?|runs?|swims?)\b/.test(
      query
    );
  const batchWorkoutWrite =
    workoutWrite &&
    /\b(week(?:'s)?|weekly|workouts|sessions|multiple|several|training days)\b/.test(query);
  const planWrite =
    /\b(edit|modify|change|apply|update|add)\b.*\b(atp|annual|plan|periodi|week|block|race)\b/.test(
      query
    );
  const rawReads =
    /\b(review|completed|activity|intervals?|laps?|wellness|recovery|sleep|hrv|power curve|pace curve|route|terrain|weather|exact|raw)\b/.test(
      query
    );
  const protocolReads =
    /\b(section 11|season|phase|readiness|load|durability|distribution|tid|acwr|monotony|strain|dfa|threshold)\b/.test(
      query
    );
  return all.filter(
    (tool) =>
      (tool.name === "createWorkout" && workoutWrite && !batchWorkoutWrite) ||
      (tool.name === "createWorkouts" && batchWorkoutWrite) ||
      (tool.name === "updateAnnualPlan" && planWrite) ||
      (tool.name === "getSection11Artifact" && (rawReads || protocolReads)) ||
      (READ_OPERATIONS.some(([name]) => name === tool.name) && rawReads)
  );
}

function explicitConfirmation(message) {
  const value = String(message || "").trim();
  return (
    /\b(confirm(?:ed)?|yes[, ]*(?:please|do|apply|create|save)|go ahead|do it|apply it|create it|save it|looks good[, ]*(?:apply|create|save))\b/i.test(
      value
    ) || /^(?:yes|yep|yeah|ok(?:ay)?|sure)[.! ]*$/i.test(value)
  );
}

function validateStructuredWorkout(workout) {
  const doc = workout?.workout_doc;
  if (
    !doc ||
    typeof doc !== "object" ||
    Array.isArray(doc) ||
    !Array.isArray(doc.steps) ||
    !doc.steps.length
  )
    throw new Error(
      "Create a complete Intervals.icu workout_doc with at least one structured step before presenting the workout."
    );
  const leaves = [];
  const walk = (steps, depth = 0) => {
    if (depth > 8) throw new Error("The workout structure is nested too deeply.");
    for (const step of steps) {
      if (step?.steps) {
        if (!Array.isArray(step.steps) || !step.steps.length)
          throw new Error("Every repeat group needs structured steps.");
        walk(step.steps, depth + 1);
      } else leaves.push(step);
    }
  };
  walk(doc.steps);
  if (
    !leaves.length ||
    leaves.some(
      (step) =>
        !(
          Number(step?.duration) > 0 ||
          Number(step?.distance) > 0 ||
          Number(step?.distance_meters) > 0
        )
    )
  )
    throw new Error("Every structured workout step needs a duration or distance.");
}

function validateScheduledDay(workout, context, userMessage) {
  const date = String(workout?.date || "");
  const existing = (context?.planned || []).filter(
    (item) => item.workout_date === date && !item.completed
  );
  if (
    existing.length &&
    !/\b(add|another|second|double|brick)\b/i.test(String(userMessage || ""))
  ) {
    throw new Error(
      `A workout is already planned on ${date}: ${existing.map((item) => item.title).join(", ")}. Ask whether to keep it or add another session; do not present an approval yet.`
    );
  }
}

export function createSection11Adapter({
  request,
  context,
  currentDate,
  userMessage,
  createWorkout,
  getAnnualPlans,
  updateAnnualPlan,
  onPreview,
  allowConfirmedWrites = true,
} = {}) {
  return async (name, args = {}) => {
    if (name === "getSection11Snapshot") return section11Snapshot(context, currentDate);
    if (name === "getAnnualPlans")
      return getAnnualPlans
        ? { source: "application", data: await getAnnualPlans() }
        : { source: "application", unavailable: "Annual plans are unavailable." };
    if (name === "getSection11Artifact") {
      const artifact = context?.section11_artifacts?.[args.artifact];
      if (!artifact)
        return {
          source: "intervals.icu",
          unavailable: `Section 11 ${args.artifact || "artifact"} is unavailable.`,
        };
      if (!args.id)
        return {
          source: "intervals.icu",
          producer: "official-section-11-sync",
          artifact: args.artifact,
          data: artifact,
        };
      const rows = Array.isArray(artifact)
        ? artifact
        : artifact.activities || artifact.events || [];
      const id = String(args.id).replace(/^(?:activity|event):/, "");
      const match = rows.find((row) =>
        [row.id, row.activity_id, row.event_id].some(
          (value) => String(value ?? "").replace(/^(?:activity|event):/, "") === id
        )
      );
      return match
        ? {
            source: "intervals.icu",
            producer: "official-section-11-sync",
            artifact: args.artifact,
            data: match,
          }
        : {
            source: "intervals.icu",
            unavailable: `No ${args.artifact} record matched ${args.id}.`,
          };
    }
    if (name === "createWorkout") {
      validateStructuredWorkout(args.workout);
      validateScheduledDay(args.workout, context, userMessage);
      const workout = args.workout;
      const preview = { operation: "create_workout", workout, requires_confirmation: true };
      if (!args.confirmed || !allowConfirmedWrites) {
        const result = { ...preview, status: "preview", not_applied: true };
        onPreview?.(result);
        return result;
      }
      if (!explicitConfirmation(userMessage))
        return {
          ...preview,
          status: "confirmation_required",
          not_applied: true,
          note: "Ask the athlete to confirm the exact preview in a new message.",
        };
      if (!createWorkout) return { ...preview, status: "unavailable", not_applied: true };
      return {
        source: "intervals",
        operation: "create_workout",
        verified: true,
        event: await createWorkout(workout),
      };
    }
    if (name === "createWorkouts") {
      if (!Array.isArray(args.workouts) || args.workouts.length < 2)
        throw new Error("A multi-workout request needs the complete batch, not a single workout.");
      if (args.workouts.length > 14)
        throw new Error("A workout batch cannot contain more than 14 workouts.");
      for (const workout of args.workouts) {
        validateStructuredWorkout(workout);
        validateScheduledDay(workout, context, userMessage);
      }
      const workouts = args.workouts;
      const dates = workouts.map((workout) => String(workout.date || "")).sort();
      const first = new Date(`${dates[0]}T12:00:00Z`),
        last = new Date(`${dates.at(-1)}T12:00:00Z`);
      if (
        !Number.isFinite(first.valueOf()) ||
        !Number.isFinite(last.valueOf()) ||
        last - first > 7 * 86400_000
      )
        throw new Error("The workout batch must cover one valid calendar week.");
      const preview = {
        operation: "create_workouts",
        reason: String(args.reason || ""),
        workouts,
        requires_confirmation: true,
      };
      if (!args.confirmed || !allowConfirmedWrites) {
        const result = { ...preview, status: "preview", not_applied: true };
        onPreview?.(result);
        return result;
      }
      if (!explicitConfirmation(userMessage))
        return {
          ...preview,
          status: "confirmation_required",
          not_applied: true,
          note: "Ask the athlete to confirm the exact preview in a new message.",
        };
      if (!createWorkout) return { ...preview, status: "unavailable", not_applied: true };
      const events = [];
      for (const workout of workouts) events.push(await createWorkout(workout));
      return { source: "intervals", operation: "create_workouts", verified: true, events };
    }
    if (name === "updateAnnualPlan") {
      const preview = {
        operation: "update_annual_plan",
        plan_id: args.plan_id,
        range_start: args.range_start,
        range_end: args.range_end,
        reason: args.reason,
        changes: args.changes,
        requires_confirmation: true,
      };
      if (!args.confirmed || !allowConfirmedWrites) {
        const result = { ...preview, status: "preview", not_applied: true };
        onPreview?.(result);
        return result;
      }
      if (!explicitConfirmation(userMessage))
        return {
          ...preview,
          status: "confirmation_required",
          not_applied: true,
          note: "Ask the athlete to confirm the exact preview in a new message.",
        };
      if (!updateAnnualPlan) return { ...preview, status: "unavailable", not_applied: true };
      return {
        source: "application",
        operation: "update_annual_plan",
        verified: true,
        plan: await updateAnnualPlan(args),
      };
    }
    const operation = READ_OPERATIONS.find(([operationName]) => operationName === name);
    if (!operation)
      return {
        source: "intervals",
        unavailable: "Unknown read operation. No data was invented or changed.",
      };
    if (!request)
      return { source: "intervals", unavailable: "Connect Intervals.icu in Settings first." };

    const [, template, parameters] = operation;
    let pathname = template;
    const query = new URLSearchParams();
    for (const [parameter, location, required] of parameters) {
      const value = args[parameter];
      if (value == null || value === "") {
        if (required) throw new Error(`Missing ${parameter}`);
        continue;
      }
      if (DATE_FIELDS.has(parameter) && !/^\d{4}-\d{2}-\d{2}$/.test(String(value)))
        throw new Error(`Invalid ${parameter}`);
      if (location === "path")
        pathname = pathname.replace(`{${parameter}}`, encodeURIComponent(String(value)));
      else query.set(parameter, String(value));
    }
    if (args.oldest && args.newest && args.oldest > args.newest)
      throw new Error("Invalid date range");
    if (pathname.includes("{")) throw new Error("Missing path parameter");

    if (pathname.startsWith("/activity/")) {
      const id = pathname.split("/")[2];
      const [detail, athlete] = await Promise.all([
        request(`/activity/${id}`),
        request("/athlete/0"),
      ]);
      if (String(detail.icu_athlete_id ?? detail.athlete_id) !== String(athlete.id))
        throw new Error("Activity ownership could not be verified");
    }

    return {
      source: "intervals",
      access: "read_only",
      units: {
        moving_time: "seconds",
        distance: "metres",
        threshold_pace: "metres/second",
        sleepSecs: "seconds",
        hrv: "milliseconds",
        restingHR: "bpm",
      },
      data: await request(pathname + (query.size ? `?${query}` : "")),
    };
  };
}
