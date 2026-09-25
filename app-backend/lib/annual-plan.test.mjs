import test from "node:test";
import assert from "node:assert/strict";
import {
  generateAnnualPlan,
  mergeRegeneratedPlan,
  recordPlanRevision,
  rollAnnualPlan,
  seasonWeekCount,
} from "./annual-plan.mjs";
import { rollingPlanWindow } from "./rolling-plan-window.mjs";

const settings = {
  name: "2027 season",
  startDate: "2026-11-02",
  endDate: "2027-10-31",
  mode: "automatic",
  methodology: "hours",
  baseline: 10,
  recoveryCycle: 4,
  availability: { mon: 90, tue: 90, wed: 90, thu: 90, fri: 60, sat: 240, sun: 180 },
  events: [
    {
      id: "race-a",
      name: "Goal race",
      date: "2027-10-10",
      sport: "Triathlon",
      distance: "70.3",
      priority: "A",
    },
  ],
};

test("annual plan uses Monday-Sunday weeks across years", () => {
  const plan = generateAnnualPlan(settings, { fitness: 50, fatigue: 55 });
  assert.equal(seasonWeekCount(plan.startDate, plan.endDate), 52);
  assert.equal(plan.weeks.length, 52);
  assert.equal(plan.weeks[0].startDate, "2026-11-02");
  assert.equal(plan.weeks.at(-1).endDate, "2027-10-31");
  assert.equal(plan.weeks.find((week) => week.startDate === "2027-10-04").phase, "Race");
});

test("automatic generation can start without a race or hours baseline and validates the editable range", () => {
  const blank = generateAnnualPlan({ ...settings, events: [], baseline: null });
  assert.ok(blank.weeks.every((week) => week.phase === "Not Set" && week.targetHours === null));
  assert.throws(
    () => generateAnnualPlan({ ...settings, endDate: "2026-11-15" }),
    /between 4 and 104/
  );
});

test("manual generation produces editable blank targets", () => {
  const plan = generateAnnualPlan({
    ...settings,
    mode: "manual",
    events: [
      {
        id: "race-unset",
        name: "Calendar race",
        date: "2027-09-01",
        sport: "Triathlon",
        priority: null,
      },
    ],
    baseline: null,
  });
  assert.ok(plan.weeks.every((week) => week.phase === "Not Set" && week.targetHours === null));
  assert.equal(plan.events[0].priority, null);
});

test("target CTL planning refuses to invent missing current fitness", () => {
  const events = [{ ...settings.events[0], targetCtl: 80 }];
  assert.throws(
    () =>
      generateAnnualPlan(
        { ...settings, methodology: "target_ctl", baseline: null, events },
        { fitness: null, fatigue: 55 }
      ),
    /Current CTL is unavailable/
  );
});

test("regeneration preserves locked, manual, and unselected weeks", () => {
  const plan = generateAnnualPlan(settings, { fitness: 50, fatigue: 55 });
  const locked = { ...plan.weeks[0], locked: true, targetHours: 3 };
  const manual = { ...plan.weeks[1], manual: true, targetHours: 4 };
  const existing = { ...plan, weeks: [locked, manual, ...plan.weeks.slice(2)] };
  const regenerated = generateAnnualPlan(
    { ...settings, baseline: 12, id: plan.id },
    { fitness: 50, fatigue: 55 }
  );
  const merged = mergeRegeneratedPlan(existing, regenerated, [
    plan.weeks[0].id,
    plan.weeks[1].id,
    plan.weeks[2].id,
  ]);
  assert.equal(merged.weeks[0].targetHours, 3);
  assert.equal(merged.weeks[1].targetHours, 4);
  assert.notEqual(merged.weeks[2].targetHours, plan.weeks[2].targetHours);
  assert.equal(merged.weeks[3].targetHours, plan.weeks[3].targetHours);
});

test("revision records a restorable compact snapshot", () => {
  const plan = generateAnnualPlan(settings, { fitness: 50, fatigue: 55 });
  const revised = recordPlanRevision(plan, "Changed targets");
  assert.equal(revised.revision, 1);
  assert.equal(revised.revisionHistory[0].reason, "Changed targets");
  assert.equal(revised.revisionHistory[0].weeks.length, 52);
});

test("rolling window spans six calendar months on each side in whole weeks", () => {
  assert.deepEqual(rollingPlanWindow("2026-09-25"), {
    startDate: "2026-03-23",
    endDate: "2027-03-28",
  });
  assert.deepEqual(rollingPlanWindow("2028-08-31"), {
    startDate: "2028-02-28",
    endDate: "2029-03-04",
  });
});

test("rolling plan preserves edited weeks and archives weeks outside the visible year", () => {
  const original = generateAnnualPlan({
    ...settings,
    startDate: "2026-03-16",
    endDate: "2027-03-21",
  });
  const edited = {
    ...original,
    events: settings.events,
    weeks: original.weeks.map((week) =>
      week.startDate === "2026-09-21"
        ? { ...week, targetHours: 12, notes: "Keep this note", manual: true }
        : week
    ),
  };
  const rolled = rollAnnualPlan(edited, "2026-09-25");
  assert.equal(rolled.startDate, "2026-03-23");
  assert.equal(rolled.endDate, "2027-03-28");
  assert.equal(rolled.weeks[0].startDate, "2026-03-23");
  assert.equal(rolled.weeks.at(-1).endDate, "2027-03-28");
  assert.equal(rolled.weeks.find((week) => week.id === "2026-09-21").notes, "Keep this note");
  assert.equal(rolled.weeks.find((week) => week.id === "2026-09-21").targetHours, 12);
  assert.equal(rolled.archivedWeeks.find((week) => week.id === "2026-03-16").id, "2026-03-16");
  assert.equal(rollAnnualPlan(rolled, "2026-09-25"), rolled);

  const regenerated = generateAnnualPlan({ ...rolled, baseline: 12 });
  const merged = mergeRegeneratedPlan(rolled, regenerated);
  assert.equal(merged.archivedWeeks.find((week) => week.id === "2026-03-16").id, "2026-03-16");
  assert.equal(merged.events.find((event) => event.id === "race-a").date, "2027-10-10");

  const advanced = rollAnnualPlan(rolled, "2026-10-02");
  assert.equal(advanced.archivedWeeks.find((week) => week.id === "2026-03-16").id, "2026-03-16");
  assert.equal(advanced.weeks.find((week) => week.id === "2026-09-21").notes, "Keep this note");
  assert.ok(advanced.weeks.some((week) => week.startDate === "2027-03-29"));
});
