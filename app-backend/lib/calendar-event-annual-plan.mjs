import { athleteLocalDate } from "./athlete-date.mjs";
import { generateAnnualPlan, mergeRegeneratedPlan, rollAnnualPlan } from "./annual-plan.mjs";

// Keep calendar Event editing and clipboard moves on the same ATP projection.
export async function synchronizeCalendarEventAnnualPlans({
  event,
  providerEvent,
  plans,
  local,
  snapshot,
  savePlan,
  now = () => new Date(),
}) {
  const id = event.id,
    activeId = local.active_annual_plan_id || plans[0]?.id;
  if (!/^event:[1-9]\d*$/.test(id || "")) throw Error("Choose a verified saved Event.");
  let plan = null;
  for (const existing of plans) {
    const present = existing.events.some((item) => item.id === id),
      include = ["A", "B", "C"].includes(event.priority);
    if (!present && (!include || existing.id !== activeId)) continue;
    const planEvent = {
      id,
      name: event.name,
      date: event.date,
      sport: providerEvent.type || "Other",
      distance: "",
      priority: event.priority,
      goal: "",
      targetCtl: null,
      source: "intervals-calendar",
    };
    const events = present
      ? existing.events.flatMap((item) =>
          item.id === id ? (include ? [{ ...item, ...planEvent }] : []) : [item]
        )
      : [...existing.events, planEvent];
    if (JSON.stringify(events) === JSON.stringify(existing.events)) {
      if (existing.id === activeId) plan = existing;
      continue;
    }
    const today = athleteLocalDate(
      now(),
      snapshot?.athlete?.time_zone || local.athlete?.time_zone || "America/Chicago"
    );
    const current = rollAnnualPlan(existing, today, snapshot?.metrics || {});
    const generated = generateAnnualPlan(
      { ...current, mode: "automatic", methodology: "hours", events },
      snapshot?.metrics || {}
    );
    const saved = await savePlan({
      ...mergeRegeneratedPlan(current, generated),
      events,
      updatedAt: now().toISOString(),
    });
    if (existing.id === activeId) plan = saved;
  }
  return plan;
}
