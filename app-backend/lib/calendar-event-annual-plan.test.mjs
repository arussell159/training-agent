import test from "node:test";
import assert from "node:assert/strict";
import { generateAnnualPlan } from "./annual-plan.mjs";
import { synchronizeCalendarEventAnnualPlans } from "./calendar-event-annual-plan.mjs";
const event = { id: "event:42", name: "Synthetic race", date: "2026-11-30", priority: "B" };
const makePlan = (id, events) => ({
  ...generateAnnualPlan({
    name: "Synthetic season",
    startDate: "2026-11-02",
    endDate: "2027-01-31",
    mode: "automatic",
    methodology: "hours",
    baseline: 6,
    events,
  }),
  id,
});
const now = () => new Date("2026-10-20T12:00:00Z");
test("Event move updates same-ID races in existing ATP plans, preserves other events and does not mutate inputs", async () => {
  const source = {
    ...event,
    date: "2026-11-16",
    sport: "Run",
    distance: "",
    goal: "",
    targetCtl: null,
    source: "intervals-calendar",
  };
  const other = {
    id: "event:99",
    name: "Unrelated race",
    date: "2027-01-03",
    priority: "A",
    sport: "Run",
  };
  const plans = [makePlan("active", [source, other]), makePlan("archived", [source])],
    before = structuredClone(plans),
    saved = [];
  const run = () =>
    synchronizeCalendarEventAnnualPlans({
      event,
      providerEvent: { type: "Run" },
      plans,
      local: { active_annual_plan_id: "active" },
      snapshot: { metrics: { fitness: 30 }, athlete: { time_zone: "America/Chicago" } },
      savePlan: async (value) => {
        saved.push(value);
        plans[plans.findIndex((plan) => plan.id === value.id)] = value;
        return value;
      },
      now,
    });
  const active = await run();
  assert.equal(active.id, "active");
  assert.equal(saved.length, 2);
  assert.equal(saved[0].events.find((row) => row.id === event.id).date, event.date);
  assert.equal(saved[1].events[0].id, event.id);
  assert.deepEqual(
    saved[0].events.find((row) => row.id === other.id),
    before[0].events.find((row) => row.id === other.id)
  );
  assert.equal(before[0].events[0].date, "2026-11-16");
  await run();
  assert.equal(saved.length, 2, "verified receipt replays must not regenerate unchanged ATP plans");
});
test("unspecified copied Event does not add an ATP race, while changing an existing race to unspecified removes only its identity", async () => {
  const plans = [makePlan("active", [{ ...event, sport: "Run" }])],
    saved = [];
  const base = {
    providerEvent: { type: "Run" },
    plans,
    local: { active_annual_plan_id: "active" },
    snapshot: null,
    savePlan: async (value) => {
      saved.push(value);
      return value;
    },
    now,
  };
  assert.equal(
    await synchronizeCalendarEventAnnualPlans({
      ...base,
      event: { ...event, id: "event:43", priority: "" },
    }),
    null
  );
  assert.equal(saved.length, 0);
  const removed = await synchronizeCalendarEventAnnualPlans({
    ...base,
    event: { ...event, priority: "" },
  });
  assert.deepEqual(removed.events, []);
  assert.equal(saved.length, 1);
  assert.equal(plans[0].events.length, 1);
});
