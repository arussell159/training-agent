import test from "node:test";
import assert from "node:assert/strict";
import { copyCalendarWorkout } from "./calendar-workout-copy.mjs";
import { changeIntervalsEvent, moveIntervalsEvent } from "./intervals.mjs";

const creationId = "00000000-0000-4000-8000-000000000001";
const input = { creationId, date: "2026-10-20" };
function fixture() {
  let state = { operation: null },
    posts = 0,
    hidden = false,
    lost = false,
    rejected = false;
  const events = new Map([
    [
      "1",
      {
        id: 1,
        category: "WORKOUT",
        type: "Ride",
        name: "Intervals",
        description: "- 5m 100w",
        start_date_local: "2026-10-17T06:30:00",
        end_date_local: "2026-10-18T06:30:00",
        tags: ["race"],
        paired_activity_id: "i99",
        time_target: 300,
      },
    ],
  ]);
  const record = {
    read: async () => structuredClone(state),
    update: async (change) => {
      const draft = structuredClone(state);
      const result = change(draft);
      state = draft;
      return structuredClone(result);
    },
  };
  const request = async (path, options = {}) => {
    if (options.method === "POST") {
      posts++;
      if (rejected) throw Object.assign(Error("Rejected"), { status: 403 });
      const event = { ...JSON.parse(options.body), id: 2 };
      events.set("2", event);
      if (lost) throw Error("Response lost after acceptance");
      return structuredClone(event);
    }
    if (path.includes("?")) return hidden ? [] : structuredClone([...events.values()]);
    const event = events.get(path.split("/").at(-1));
    if (!event) throw Object.assign(Error("Not found"), { status: 404 });
    return structuredClone(event);
  };
  return {
    record,
    request,
    events,
    posts: () => posts,
    state: () => structuredClone(state),
    hide: (value) => (hidden = value),
    lose: (value) => (lost = value),
    reject: (value) => (rejected = value),
  };
}
const copy = (f, values = input) =>
  copyCalendarWorkout({}, f.request, "event:1", values, { record: f.record });

test("verified copies preserve native fields, start time and multi-day span without recorded links", async () => {
  const f = fixture(),
    result = await copy(f);
  assert.equal(result.workoutId, "event:2");
  assert.equal(result.event.start_date_local, "2026-10-20T06:30:00");
  assert.equal(result.event.end_date_local, "2026-10-21T06:30:00");
  assert.equal(result.event.description, "- 5m 100w");
  assert.deepEqual(result.event.tags, ["race"]);
  assert.equal(result.event.paired_activity_id, undefined);
  assert.equal(f.posts(), 1);
  assert.equal((await copy(f)).workoutId, "event:2");
  assert.equal(f.posts(), 1);
});

test("a lost response with delayed provider lists reconciles across instances without another POST", async () => {
  const f = fixture();
  f.lose(true);
  f.hide(true);
  await assert.rejects(copy(f), (error) => error.code === "COPY_UNCONFIRMED");
  assert.equal(f.posts(), 1);
  await assert.rejects(copy(f), (error) => error.code === "COPY_UNCONFIRMED");
  assert.equal(f.posts(), 1);
  f.hide(false);
  const result = await copyCalendarWorkout({}, f.request, "event:1", input, { record: f.record });
  assert.equal(result.verified, true);
  assert.equal(f.posts(), 1);
});

test("simultaneous callers across instances claim exactly one provider creation", async () => {
  const f = fixture();
  const results = await Promise.allSettled([copy(f), copy(f), copy(f)]);
  assert.ok(results.some((result) => result.status === "fulfilled"));
  assert.equal(f.posts(), 1);
  assert.equal((await copy(f)).verified, true);
});

test("paste identity is bound to its source and destination and retains the original fields", async () => {
  const f = fixture();
  f.lose(true);
  f.hide(true);
  await assert.rejects(copy(f));
  await assert.rejects(
    copy(f, { ...input, date: "2026-10-21" }),
    (error) => error.code === "COPY_CONFLICT"
  );
  f.events.get("1").description = "Changed after the paste";
  f.hide(false);
  assert.equal((await copy(f)).event.description, "- 5m 100w");
  assert.equal(f.posts(), 1);
});

test("provider rejection, failed verification and deletion never permit a blind repeated creation", async () => {
  const f = fixture();
  f.reject(true);
  await assert.rejects(copy(f), (error) => error.code === "COPY_REJECTED");
  await assert.rejects(copy(f), (error) => error.code === "COPY_REJECTED");
  assert.equal(f.posts(), 1);
  const g = fixture();
  await copy(g);
  g.events.delete("2");
  await assert.rejects(copy(g), (error) => error.status === 404);
  assert.equal(g.posts(), 1);
  const h = fixture();
  await copy(h);
  h.events.get("2").time_target = 999;
  await assert.rejects(copy(h), (error) => error.code === "COPY_UNCONFIRMED");
  assert.equal(h.posts(), 1);
});

test("invalid paste inputs fail before provider writes", async () => {
  const f = fixture();
  await assert.rejects(copy(f, { ...input, creationId: "bad" }));
  await assert.rejects(copy(f, { ...input, date: "2026-02-30" }));
  assert.equal(f.posts(), 0);
});

test("a provider read failure before the POST claim can resume safely", async () => {
  const f = fixture();
  let failed = false;
  const request = async (path, options) => {
    if (path.includes("?") && !failed) {
      failed = true;
      throw Error("Temporary read outage");
    }
    return f.request(path, options);
  };
  await assert.rejects(
    copyCalendarWorkout({}, request, "event:1", input, { record: f.record }),
    /read outage/
  );
  assert.equal(f.posts(), 0);
  assert.equal(f.state().operation.state, "prepared");
  assert.equal(
    (await copyCalendarWorkout({}, request, "event:1", input, { record: f.record })).verified,
    true
  );
  assert.equal(f.posts(), 1);
});

test("already absent deletions and already applied moves verify without another write", async () => {
  let writes = 0;
  const absent = async (_path, options) => {
    if (options?.method) writes++;
    throw Object.assign(Error("404"), { status: 404 });
  };
  assert.equal((await changeIntervalsEvent(absent, "event:1", "delete")).verified, true);
  const current = {
    id: 1,
    start_date_local: "2026-10-20T06:30:00",
    end_date_local: "2026-10-21T06:30:00",
  };
  assert.equal(
    (
      await moveIntervalsEvent(
        async (_path, options) => {
          if (options?.method) writes++;
          return current;
        },
        "event:1",
        "2026-10-20"
      )
    ).verified,
    true
  );
  assert.equal(writes, 0);
});

test("freshly paired and read-only events reject moves and deletion before any provider write", async () => {
  for (const protection of [
    { paired_activity_id: "i99" },
    { read_only: true },
    { readonly: true },
    { editable: false },
    { athlete_cannot_edit: true },
  ]) {
    let writes = 0;
    const request = async (_path, options = {}) => {
      if (options.method) writes++;
      return { id: 1, start_date_local: "2026-10-17T06:30:00", ...protection };
    };
    await assert.rejects(
      moveIntervalsEvent(request, "event:1", "2026-10-20"),
      (error) => error.status === 403
    );
    await assert.rejects(
      changeIntervalsEvent(request, "event:1", "delete"),
      (error) => error.status === 403
    );
    assert.equal(writes, 0);
  }
});
