import test from "node:test";
import assert from "node:assert/strict";
import {
  scheduleLibraryWorkout,
  scheduleCoachWorkouts,
  coachWorkoutCreationId,
} from "./workout-scheduling.mjs";
const creationId = "00000000-0000-4000-8000-000000000099",
  date = "2026-10-22";
function harness() {
  const records = new Map(),
    events = new Map(),
    calls = [];
  let lose = false,
    hide = false,
    rejectName = "",
    corrupt = false;
  const library = {
    id: 15,
    name: "Aerobic run",
    type: "Run",
    description: "- 45m Z2 HR",
    time_target: 2700,
    load_target: 44,
  };
  const recordFor = (id) => ({
    read: async () => structuredClone(records.get(id) || { operation: null }),
    update: async (fn) => {
      const state = structuredClone(records.get(id) || { operation: null });
      const result = fn(state);
      records.set(id, state);
      return structuredClone(result);
    },
  });
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path === "/athlete/0/workouts/15") return structuredClone(library);
    if (path.includes("?")) return hide ? [] : structuredClone([...events.values()]);
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      if (body.name === rejectName) throw Object.assign(Error("Rejected"), { status: 403 });
      const event = { ...body, id: events.size + 100 };
      events.set(String(event.id), event);
      if (lose) throw Error("Reply lost");
      return structuredClone(event);
    }
    const event = events.get(path.split("/").at(-1));
    if (!event) throw Object.assign(Error("Missing"), { status: 404 });
    return { ...structuredClone(event), ...(corrupt ? { description: "Wrong steps" } : {}) };
  };
  return {
    request,
    recordFor,
    events,
    library,
    calls,
    lose: (value) => (lose = value),
    hide: (value) => (hide = value),
    reject: (value) => (rejectName = value),
    corrupt: (value) => (corrupt = value),
    posts: () => calls.filter((call) => call.method === "POST").length,
  };
}
const proposal = {
  id: "9fc8da63-e749-437d-8bb1-c9171c730abc",
  workouts: [
    {
      name: "Coach run",
      type: "Run",
      date,
      description: "- 30m Z2 HR",
      duration_minutes: 30,
      tss: 20,
      indoor: false,
    },
    {
      name: "Coach bike",
      type: "Ride",
      date,
      description: "- 45m 180w",
      duration_minutes: 45,
      tss: 40,
      indoor: true,
    },
  ],
};

test("library scheduling copies native steps and planned targets, then verifies a separate event", async () => {
  const h = harness();
  const input = { date, creationId };
  const result = await scheduleLibraryWorkout({}, h.request, "library:15", input, {
    record: h.recordFor(creationId),
  });
  assert.equal(result.verified, true);
  assert.equal(result.event.description, h.library.description);
  assert.equal(result.event.time_target, 2700);
  assert.equal(result.event.load_target, 44);
  assert.equal(result.event.start_date_local, date + "T00:00:00");
  assert.equal(result.workout.id, "event:100");
  assert.equal(h.posts(), 1);
  h.library.description = "Changed later";
  const again = await scheduleLibraryWorkout(
    {},
    h.request,
    "library:15",
    { ...input, reconcileOnly: true },
    { record: h.recordFor(creationId) }
  );
  assert.equal(again.event.description, "- 45m Z2 HR");
  assert.equal(h.posts(), 1);
});
test("library lost replies reconcile across instances without another provider POST", async () => {
  const h = harness();
  h.lose(true);
  h.hide(true);
  const run = () =>
    scheduleLibraryWorkout(
      {},
      h.request,
      "library:15",
      { date, creationId },
      { record: h.recordFor(creationId) }
    );
  await assert.rejects(run());
  await assert.rejects(run());
  assert.equal(h.posts(), 1);
  h.hide(false);
  assert.equal((await run()).verified, true);
  assert.equal(h.posts(), 1);
});
test("parallel library requests, changed dates, invalid IDs and corrupt provider reads cannot duplicate or falsely confirm", async () => {
  const h = harness(),
    run = () =>
      scheduleLibraryWorkout(
        {},
        h.request,
        "library:15",
        { date, creationId },
        { record: h.recordFor(creationId) }
      );
  assert.ok(
    (await Promise.allSettled([run(), run(), run()])).some((item) => item.status === "fulfilled")
  );
  assert.equal(h.posts(), 1);
  await assert.rejects(
    scheduleLibraryWorkout(
      {},
      h.request,
      "library:15",
      { date: "2026-10-23", creationId },
      { record: h.recordFor(creationId) }
    ),
    /bound/
  );
  await assert.rejects(
    scheduleLibraryWorkout({}, h.request, "event:15", { date, creationId }),
    /valid saved/
  );
  h.corrupt(true);
  await assert.rejects(run(), /differs/);
  assert.equal(h.posts(), 1);
});
test("rechecking an unsent library request never starts a provider write", async () => {
  const h = harness();
  await assert.rejects(
    scheduleLibraryWorkout(
      {},
      h.request,
      "library:15",
      { date, creationId, reconcileOnly: true },
      { record: h.recordFor(creationId) }
    ),
    /not confirmed/
  );
  assert.equal(h.posts(), 0);
});
test("coach batches verify every native workout and repeated approvals create each exactly once", async () => {
  const h = harness(),
    run = () => scheduleCoachWorkouts({}, h.request, proposal, { recordFor: h.recordFor });
  const result = await run();
  assert.equal(result.verified, true);
  assert.equal(result.scheduledWorkouts.length, 2);
  assert.equal(h.posts(), 2);
  assert.deepEqual(
    result.events.map((item) => item.event.description),
    proposal.workouts.map((item) => item.description)
  );
  assert.equal(result.events[1].event.indoor, true);
  assert.equal(result.events[1].event.time_target, 2700);
  assert.equal((await run()).verified, true);
  assert.equal(h.posts(), 2);
  assert.notEqual(coachWorkoutCreationId(proposal.id, 0), coachWorkoutCreationId(proposal.id, 1));
  assert.match(
    coachWorkoutCreationId(proposal.id, 0),
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/
  );
});
test("partial coach batches retain verified items; status reads cannot create the remaining workouts", async () => {
  const h = harness();
  h.lose(true);
  h.hide(true);
  const first = await scheduleCoachWorkouts({}, h.request, proposal, { recordFor: h.recordFor });
  assert.equal(first.verified, false);
  assert.equal(first.scheduledWorkouts.length, 0);
  assert.equal(h.posts(), 1);
  h.lose(false);
  h.hide(false);
  const checked = await scheduleCoachWorkouts({}, h.request, proposal, {
    recordFor: h.recordFor,
    reconcileOnly: true,
  });
  assert.equal(checked.verified, false);
  assert.equal(checked.scheduledWorkouts.length, 1);
  assert.equal(h.posts(), 1);
  const resumed = await scheduleCoachWorkouts({}, h.request, proposal, { recordFor: h.recordFor });
  assert.equal(resumed.verified, true);
  assert.equal(h.posts(), 2);
});
test("an explicit coach retry may recover a definite rejection but status reads never retry POST", async () => {
  const h = harness();
  h.reject("Coach bike");
  const first = await scheduleCoachWorkouts({}, h.request, proposal, { recordFor: h.recordFor });
  assert.equal(first.scheduledWorkouts.length, 1);
  assert.equal(first.verified, false);
  assert.equal(h.posts(), 2);
  h.reject("");
  const read = await scheduleCoachWorkouts({}, h.request, proposal, {
    recordFor: h.recordFor,
    reconcileOnly: true,
  });
  assert.equal(read.verified, false);
  assert.equal(h.posts(), 2);
  const retry = await scheduleCoachWorkouts({}, h.request, proposal, { recordFor: h.recordFor });
  assert.equal(retry.verified, true);
  assert.equal(h.events.size, 2);
  assert.equal(h.posts(), 3);
});
