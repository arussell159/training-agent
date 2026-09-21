const marker = (kind, target) => {
  if (kind === "pre") return `[[SECTION11_REPORT:PRE_WORKOUT:${target.workoutId}]]`;
  if (kind === "post") return `[[SECTION11_REPORT:POST_WORKOUT:${target.workoutId}]]`;
  return `[[SECTION11_REPORT:${kind.toUpperCase()}:${target.startDate}${kind === "block" ? `:${target.endDate}` : ""}]]`;
};

const closing = (kind, target) =>
  marker(kind, target).replace("[[SECTION11_REPORT:", "[[/SECTION11_REPORT:");

const legacyMarker = (kind, target) =>
  kind === "post"
    ? `[[SECTION11_REPORT:POST_WORKOUT:${target.workoutId.replace(/^activity:/, "")}]]`
    : null;

function body(kind, target, text) {
  return `${marker(kind, target)}\n${text.trim()}\n${closing(kind, target)}`;
}

async function one(request, path) {
  const value = await request(path);
  return Array.isArray(value) ? value : value ? [value] : [];
}

export function createIntervalsReportPublisher(request) {
  async function publish(target, text) {
    const content = body(target.kind, target, text);
    if (target.kind === "post") {
      const activityId = target.workoutId.replace(/^activity:/, "");
      const messages = await one(request, `/activity/${activityId}/messages`);
      const existing = messages.find((item) => {
        const text = String(item.content || item.text || "");
        return text.includes(marker(target.kind, target)) || (legacyMarker(target.kind, target) && text.includes(legacyMarker(target.kind, target)));
      });
      if (existing && !target.force) return { unchanged: true };
      if (existing && target.force) {
        const activity = await request(`/activity/${activityId}`);
        if (!Number.isInteger(activity.icu_chat_id) || !Number.isInteger(existing.id))
          throw new Error("Intervals.icu did not provide the activity chat/message identity for replacement.");
        await request(`/chats/${activity.icu_chat_id}/messages/${existing.id}`, {
          method: "PUT",
          body: JSON.stringify({ content }),
        });
      } else {
        await request(`/activity/${activityId}/messages`, {
          method: "POST",
          body: JSON.stringify({ content }),
        });
      }
      const after = await one(request, `/activity/${activityId}/messages`);
      if (!after.some((item) => String(item.content || item.text || "").includes(marker(target.kind, target))))
        throw new Error("Intervals.icu did not confirm the report comment.");
      return { saved: true, location: "activity_comment" };
    }

    const isPre = target.kind === "pre";
    const externalId = isPre
      ? `section11-pre-report-${target.workoutId.replace(/^event:/, "")}`
      : target.kind === "weekly"
        ? `section11-weekly-report-${target.startDate}`
        : `section11-block-report-${target.startDate}-${target.endDate}`;
    const day = target.startDate;
    const events = await one(request, `/athlete/0/events?oldest=${day}&newest=${target.endDate || day}`);
    const matches = events.filter((event) => event.external_id === externalId);
    if (matches.length > 1) throw new Error("Multiple Intervals.icu report notes share the same identifier.");
    if (matches[0]?.description?.includes(marker(target.kind, target)) && !target.force) return { unchanged: true };
    const payload = {
      category: "NOTE",
      type: "Other",
      start_date_local: `${day}T00:00:00`,
      for_week: target.kind === "weekly",
      external_id: externalId,
      name: `Section 11 ${target.kind} report — ${day}`,
      description: content,
    };
    if (matches[0]) {
      await request(`/athlete/0/events/${matches[0].id}`, {
        method: "PUT",
        body: JSON.stringify({ description: content }),
      });
    } else {
      await request("/athlete/0/events/bulk?upsert=true", {
        method: "POST",
        body: JSON.stringify([payload]),
      });
    }
    const after = await one(request, `/athlete/0/events?oldest=${day}&newest=${target.endDate || day}`);
    const saved = after.find((event) => event.external_id === externalId);
    if (!saved || saved.description !== content) throw new Error("Intervals.icu did not confirm the report note.");
    return { saved: true, location: "calendar_note" };
  }
  return { publish };
}
