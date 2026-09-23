const marker = (kind, target) => {
  return `[[SECTION11_REPORT:${kind.toUpperCase()}:${target.startDate}${kind === "block" ? `:${target.endDate}` : ""}]]`;
};

const closing = (kind, target) =>
  marker(kind, target).replace("[[SECTION11_REPORT:", "[[/SECTION11_REPORT:");

function body(kind, target, text) {
  return `${marker(kind, target)}\n${text.trim()}\n${closing(kind, target)}`;
}

async function one(request, path) {
  const value = await request(path);
  return Array.isArray(value) ? value : value ? [value] : [];
}

export function createIntervalsReportPublisher(request) {
  async function publishActivityComment(activityId, content, target) {
    const messages = await one(request, `/activity/${activityId}/messages`);
    const existing = messages.find((item) => {
      const text = String(item.content || item.text || "");
      return text.includes(marker(target.kind, target));
    });
    if (existing && !target.force) return { unchanged: true, location: "activity_comment" };
    const activity = await request(`/activity/${activityId}`);
    if (existing) {
      if (!Number.isInteger(activity.icu_chat_id) || !Number.isInteger(existing.id))
        throw new Error("Intervals.icu did not provide the activity chat/message identity for replacement.");
      await request(`/chats/${activity.icu_chat_id}/messages/${existing.id}`, { method: "PUT", body: JSON.stringify({ content }) });
    } else {
      await request(`/activity/${activityId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
    }
    const after = await one(request, `/activity/${activityId}/messages`);
    if (!after.some((item) => String(item.content || item.text || "").includes(marker(target.kind, target))))
      throw new Error("Intervals.icu did not confirm the report comment.");
    return { saved: true, location: "activity_comment", activityId };
  }

  async function publish(target, text) {
    const content = body(target.kind, target, text);
    if (target.kind === "weekly") {
      const activities = await one(request, `/athlete/0/activities?oldest=${target.startDate}&newest=${target.endDate}`);
      const latest = activities
        .filter((activity) => activity?.id != null)
        .sort((a, b) => String(b.start_date_local || b.date || b.created || "").localeCompare(String(a.start_date_local || a.date || a.created || "")))[0];
      if (!latest) throw new Error("No completed workout is available for the weekly report comment.");
      return publishActivityComment(String(latest.id), content, target);
    }
    const externalId = `section11-block-report-${target.startDate}-${target.endDate}`;
    const day = target.startDate;
    const events = await one(request, `/athlete/0/events?oldest=${day}&newest=${target.endDate || day}`);
    const matches = events.filter((event) => event.external_id === externalId);
    if (matches.length > 1) throw new Error("Multiple Intervals.icu report notes share the same identifier.");
    if (matches[0]?.description?.includes(marker(target.kind, target)) && !target.force) return { unchanged: true };
    const payload = {
      category: "NOTE",
      type: "Other",
      start_date_local: `${day}T00:00:00`,
      for_week: false,
      external_id: externalId,
      name: `Section 11 block report — ${day}`,
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
