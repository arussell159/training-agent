import { createHash, randomUUID } from "node:crypto";
import { CoachError, boundedText } from "./github-coach-source.mjs";
import { athleteLocalDate } from "./athlete-date.mjs";

export const CALENDAR_SPORTS = [
  "Ride",
  "VirtualRide",
  "MountainBikeRide",
  "GravelRide",
  "EBikeRide",
  "Run",
  "VirtualRun",
  "TrailRun",
  "Swim",
  "NordicSki",
  "VirtualSki",
  "Rowing",
  "WeightTraining",
  "Walk",
  "Hike",
  "Workout",
  "Other",
];
const DAY = 86400000;
const WORKFLOW = "push-workout.yml";
const ACTIVE = new Set(["preview_pending", "queued", "unknown"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function validateCalendarWorkouts(value, today) {
  if (!Array.isArray(value) || !value.length || value.length > 28)
    throw new CoachError("Propose between 1 and 28 planned workouts.", 400);
  const allowed = new Set([
    "name",
    "date",
    "type",
    "description",
    "duration_minutes",
    "tss",
    "target",
    "indoor",
  ]);
  const result = value.map((w) => {
    if (
      !w ||
      typeof w !== "object" ||
      Array.isArray(w) ||
      Object.keys(w).some((k) => !allowed.has(k))
    )
      throw new CoachError("A planned workout contains unsupported fields.", 400);
    if (
      typeof w.name !== "string" ||
      !w.name.trim() ||
      w.name.length > 160 ||
      /[\x00-\x1f]/.test(w.name)
    )
      throw new CoachError("Give each workout a name of at most 160 characters.", 400);
    if (
      typeof w.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(w.date) ||
      !Number.isFinite(Date.parse(w.date)) ||
      new Date(w.date).toISOString().slice(0, 10) !== w.date ||
      w.date < today ||
      Date.parse(w.date) > Date.parse(today) + 366 * DAY
    )
      throw new CoachError(
        "Workout dates must be valid local dates, today or within the next year.",
        400
      );
    if (!CALENDAR_SPORTS.includes(w.type)) throw new CoachError("Unsupported workout sport.", 400);
    if (
      typeof w.description !== "string" ||
      w.description.length > 8000 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(w.description) ||
      !/^\s*-\s*\S/m.test(w.description) ||
      /^\s*-\s*$/m.test(w.description)
    )
      throw new CoachError(
        "Supply an Intervals.icu description with non-empty workout steps starting with '-'.",
        400
      );
    for (const [key, max, min] of [
      ["duration_minutes", 720, Number.MIN_VALUE],
      ["tss", 500, 0],
    ]) {
      if (
        w[key] != null &&
        (typeof w[key] !== "number" || !Number.isFinite(w[key]) || w[key] < min || w[key] > max)
      )
        throw new CoachError(`Invalid ${key}.`, 400);
    }
    if (w.target != null && !["POWER", "HR", "PACE"].includes(w.target))
      throw new CoachError("Invalid workout target.", 400);
    if (w.indoor != null && typeof w.indoor !== "boolean")
      throw new CoachError("Invalid indoor flag.", 400);
    return Object.fromEntries(
      Object.entries({
        name: w.name.trim(),
        date: w.date,
        type: w.type,
        description: w.description,
        duration_minutes: w.duration_minutes,
        tss: w.tss,
        target: w.target,
        indoor: w.indoor,
        category: "WORKOUT",
      }).filter(([, v]) => v != null)
    );
  });
  if (Buffer.byteLength(JSON.stringify(result)) > 45000)
    throw new CoachError("This plan is too large. Propose a shorter period.", 400);
  return result;
}

export const calendarProposalTool = {
  type: "function",
  name: "propose_calendar_workouts",
  strict: true,
  description:
    "Prepare planned workouts for the athlete to review and add to Intervals.icu through GitHub. Runs push.py in preview mode only. Never writes workouts. Read Section 11 workout-design guidance and current calendar first. Use exact local YYYY-MM-DD dates and native Intervals.icu step syntax; separate swim, bike and run sessions. The athlete must click Add to Intervals.icu on this exact preview before a write can run. Reuse an existing proposal for the same plan.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["workouts"],
    properties: {
      workouts: {
        type: "array",
        minItems: 1,
        maxItems: 28,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "name",
            "date",
            "type",
            "description",
            "duration_minutes",
            "tss",
            "target",
            "indoor",
          ],
          properties: {
            name: { type: "string" },
            date: { type: "string", description: "Athlete-local date YYYY-MM-DD" },
            type: { type: "string", enum: CALENDAR_SPORTS },
            description: {
              type: "string",
              description:
                "Exact native Intervals.icu workout text, with steps starting '-'. Minutes use m; swim distance uses mtr. Include all warm-up, work, recovery and cool-down steps.",
            },
            duration_minutes: { type: ["number", "null"] },
            tss: { type: ["number", "null"] },
            target: { type: ["string", "null"], enum: ["POWER", "HR", "PACE", null] },
            indoor: { type: ["boolean", "null"] },
          },
        },
      },
    },
  },
};

export function createCoachCalendar({
  config,
  store,
  fetchImpl = fetch,
  now = Date.now,
  uuid = randomUUID,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(config.repo) || !config.branch)
    throw new CoachError("Configure the training data repository first.", 503);
  const timeZone = config.calendarTimeZone || "America/Chicago";
  const today = () => athleteLocalDate(new Date(now()), timeZone);
  const base = `https://api.github.com/repos/${config.repo}`;
  async function github(path, body) {
    let response;
    try {
      response = await fetchImpl(base + path, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${config.githubToken}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new CoachError(
        "GitHub did not confirm the request. Check status before trying another plan."
      );
    }
    if (!response.ok) {
      const error = new CoachError(
        response.status === 401 || response.status === 403
          ? "Give TRAINING_DATA_GITHUB_TOKEN Actions read and write permission on the training data repository."
          : response.status === 404
            ? "Install push-workout.yml in the training data repository and enable GitHub Actions."
            : "GitHub could not complete this calendar request. Check the workflow run.",
        502
      );
      error.definitelyRejected = [400, 401, 403, 404, 422].includes(response.status);
      throw error;
    }
    return response.status === 204
      ? {}
      : JSON.parse(await boundedText(response, 2000000, "GitHub calendar response"));
  }
  function publicProposal(p) {
    return {
      id: p.id,
      workouts: p.workouts,
      state: p.state,
      phase: p.phase,
      createdAt: p.createdAt,
      expiresAt: p.createdAt + DAY,
      timeZone,
      error: p.error || null,
      runUrl: p.runId ? `https://github.com/${config.repo}/actions/runs/${p.runId}` : null,
    };
  }
  async function record(id) {
    if (!UUID.test(id || "")) throw new CoachError("Unknown calendar proposal.", 404);
    const p = (await store.read()).proposals.find((p) => p.id === id);
    if (!p) throw new CoachError("This calendar proposal has expired. Ask for a fresh plan.", 404);
    return p;
  }
  async function update(id, change) {
    return store.update((state) => {
      const p = state.proposals.find((p) => p.id === id);
      if (!p) throw new CoachError("This proposal is no longer available.", 404);
      change(p);
      return structuredClone(p);
    });
  }
  async function checkSetup() {
    const workflow = await github(`/actions/workflows/${WORKFLOW}`);
    if (workflow.state !== "active")
      throw new CoachError("Enable the Push Workout workflow in GitHub Actions.", 503);
    const file = await github(
      `/contents/.github/workflows/${WORKFLOW}?ref=${encodeURIComponent(config.branch)}`
    );
    if (
      !Buffer.from(file.content || "", "base64")
        .toString()
        .includes("# training-agent-calendar-v1:")
    )
      throw new CoachError(
        "Install the app-compatible push-workout.yml with preview and result tracking.",
        503
      );
    return { available: true, timeZone };
  }
  async function dispatch(p) {
    try {
      const result = await github(`/actions/workflows/${WORKFLOW}/dispatches`, {
        ref: config.branch,
        inputs: {
          command: "push",
          workouts: JSON.stringify(p.workouts),
          confirm: String(p.phase === "push"),
          request_id: p.id,
          time_zone: timeZone,
        },
      });
      if (Number.isSafeInteger(result.workflow_run_id))
        p = await update(p.id, (current) => {
          if (current.phase === p.phase) current.runId = result.workflow_run_id;
        });
    } catch (error) {
      // Persisted claim is never released after a dispatch: a timeout may hide a queued run.
      p = await update(p.id, (current) => {
        if (current.phase !== p.phase || current.state === "declined") return;
        current.state = error.definitelyRejected
          ? p.phase === "preview"
            ? "preview_failed"
            : "not_applied"
          : "unknown";
        current.error =
          error instanceof CoachError
            ? error.message
            : "Unable to confirm dispatch. Check the workflow before retrying.";
      });
    }
    return publicProposal(p);
  }
  async function status(id) {
    let p = await record(id);
    if (
      p.state === "ready" &&
      (p.createdAt + DAY < now() || p.workouts.some((w) => w.date < today()))
    )
      p = await update(id, (current) => {
        if (current.state === "ready") current.state = "expired";
      });
    if (!ACTIVE.has(p.state)) return publicProposal(p);
    const title = `section11-${p.id}-${p.phase === "push"}`;
    let run;
    if (p.runId) run = await github(`/actions/runs/${p.runId}`);
    else {
      const query = new URLSearchParams({
        event: "workflow_dispatch",
        branch: config.branch,
        per_page: "100",
        created: `>=${new Date(p.dispatchedAt - 60000).toISOString()}`,
      });
      for (let page = 1; page <= 5; page++) {
        const result = await github(`/actions/workflows/${WORKFLOW}/runs?${query}&page=${page}`);
        const matches = (result.workflow_runs || []).filter((r) => r.display_title === title);
        if (matches.length > 1)
          throw new CoachError(
            "Multiple runs match this proposal. Check GitHub and the calendar before continuing."
          );
        if (matches.length) {
          run = matches[0];
          break;
        }
        if ((result.workflow_runs || []).length < 100) break;
      }
    }
    if (!run) {
      if (now() - p.dispatchedAt > 10 * 60000)
        p = await update(id, (current) => {
          if (current.phase === p.phase && ACTIVE.has(current.state)) {
            current.state = "unknown";
            current.error =
              "No matching GitHub run was found. Check GitHub before creating another plan.";
          }
        });
      return publicProposal(p);
    }
    if (
      run.display_title !== title ||
      run.event !== "workflow_dispatch" ||
      run.head_branch !== config.branch ||
      run.path?.split("@")[0] !== `.github/workflows/${WORKFLOW}`
    )
      throw new CoachError("The workflow run does not match this calendar proposal.");
    if (run.run_attempt !== 1)
      throw new CoachError("This workflow was rerun. Check the calendar before continuing.");
    let state = p.phase === "push" ? "queued" : "preview_pending";
    if (run.status === "completed") {
      const jobs = await github(`/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
      const markers = (jobs.jobs || [])
        .flatMap((j) => j.steps || [])
        .filter((s) => s.conclusion === "success" && s.name.startsWith("Calendar result: "));
      const outcome =
        markers.length === 1 ? markers[0].name.slice("Calendar result: ".length) : "unknown";
      state =
        p.phase === "preview"
          ? outcome === "preview"
            ? "ready"
            : "preview_failed"
          : outcome === "applied"
            ? "applied"
            : outcome === "not_applied"
              ? "not_applied"
              : "unknown";
    }
    p = await update(id, (current) => {
      // A slow preview poll must never roll back a concurrently confirmed write.
      if (current.phase !== p.phase || !ACTIVE.has(current.state)) return;
      current.runId = run.id;
      current.state = state;
      current.error =
        state === "unknown"
          ? "The write could not be confirmed. Check the Intervals.icu calendar before retrying."
          : state === "preview_failed"
            ? "The preview did not pass. Check the workflow result and ask the coach to correct the plan."
            : state === "not_applied"
              ? "The workflow reported that no workouts were written. Check its result before submitting a corrected plan."
              : null;
    });
    return publicProposal(p);
  }
  return {
    checkSetup,
    status,
    async list() {
      const proposals = (await store.read()).proposals;
      const recent = new Set(proposals.slice(-6).map((p) => p.id));
      return proposals
        .filter(
          (p) =>
            recent.has(p.id) ||
            ACTIVE.has(p.state) ||
            (p.state === "ready" && p.createdAt + DAY >= now())
        )
        .reverse()
        .map(publicProposal);
    },
    async propose(workouts) {
      await checkSetup();
      const clean = validateCalendarWorkouts(workouts, today());
      const fingerprint = createHash("sha256").update(JSON.stringify(clean)).digest("hex");
      const id = uuid();
      const claim = await store.update((state) => {
        state.proposals = state.proposals.filter((p) => p.createdAt > now() - 30 * DAY);
        for (const p of state.proposals)
          if (p.phase === "preview" && p.state !== "declined" && p.createdAt + DAY < now())
            p.state = "expired";
        const existing = state.proposals.find(
          (p) =>
            p.fingerprint === fingerprint &&
            !["expired", "preview_failed", "not_applied", "declined"].includes(p.state)
        );
        if (existing) return { existing: true, p: structuredClone(existing) };
        if (
          state.proposals.length >= 100 ||
          state.proposals.filter((p) => ACTIVE.has(p.state)).length >= 4
        )
          throw new CoachError("Check your pending calendar proposals before adding another.", 429);
        const p = {
          id,
          fingerprint,
          createdAt: now(),
          dispatchedAt: now(),
          phase: "preview",
          state: "preview_pending",
          workouts: clean.map((w, i) => ({ ...w, external_id: `section11:${id}:${i}` })),
        };
        state.proposals.push(p);
        return { existing: false, p: structuredClone(p) };
      });
      return claim.existing ? publicProposal(claim.p) : dispatch(claim.p);
    },
    async decline(id) {
      await record(id);
      const proposal = await update(id, (current) => {
        if (current.state === "declined") return;
        if (current.phase === "push")
          throw new CoachError(
            "This proposal has already been submitted. Check its calendar result.",
            409
          );
        current.state = "declined";
        current.error = null;
        current.declinedAt = now();
      });
      return publicProposal(proposal);
    },
    async confirm(id) {
      await record(id);
      const claim = await store.update((state) => {
        const p = state.proposals.find((p) => p.id === id);
        if (!p) throw new CoachError("Unknown calendar proposal.", 404);
        if (p.phase === "push") return { existing: true, p: structuredClone(p) };
        if (p.state !== "ready")
          throw new CoachError("Wait for a successful preview before adding these workouts.", 409);
        if (p.createdAt + DAY < now() || p.workouts.some((w) => w.date < today()))
          throw new CoachError("This preview has expired. Ask for a fresh plan.", 409);
        p.phase = "push";
        p.state = "queued";
        p.dispatchedAt = now();
        p.runId = null;
        p.error = null;
        return { existing: false, p: structuredClone(p) };
      });
      return claim.existing ? publicProposal(claim.p) : dispatch(claim.p);
    },
  };
}
