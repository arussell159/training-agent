import { appendWorkoutComment } from "./workout-comments.mjs";

const fail = (message, status = 503, code = "COMMENT_UNCONFIRMED") => {
  throw Object.assign(Error(message), { status, code });
};
const pathFor = (id) => {
  if (!/^activity:i?[1-9]\d*$/.test(id || ""))
    fail("Choose a completed activity.", 400, "INVALID_ACTIVITY");
  return `/activity/${id.slice(9)}/messages`;
};
const rows = (value) =>
  Array.isArray(value) ? value : Array.isArray(value?.messages) ? value.messages : [];
export async function loadNativeActivityComments(request, id) {
  return rows(await request(`${pathFor(id)}?limit=100`))
    .filter(
      (message) =>
        message &&
        message.id != null &&
        !message.deleted &&
        typeof message.content === "string" &&
        message.content.trim()
    )
    .map((message) => ({
      id: `intervals-message:${message.id}`,
      provider_id: String(message.id),
      workout_id: id,
      type: "post",
      body: message.content,
      created_at: message.created ?? message.created_at ?? message.timestamp ?? null,
      ...(message.athlete_id != null ? { athlete_id: message.athlete_id } : {}),
    }));
}
/** The dispatch marker is persisted by the existing durable workout journal
 * before POST. Intervals has no message idempotency key: an unknown POST can
 * only be reconciled, never automatically sent a second time. */
export async function saveNativeActivityComment(
  request,
  input,
  { intent, persistIntent, now = new Date() } = {}
) {
  if (typeof persistIntent !== "function")
    fail("Activity comments must use the durable save path.", 409, "DURABLE_COMMENT_REQUIRED");
  const comment = appendWorkoutComment(
    [],
    {
      workoutId: input.workoutId,
      body: input.body,
      type: "post",
      creationId: input.creationId,
    },
    now
  ).comment;
  const before = await loadNativeActivityComments(request, input.workoutId);
  if (intent && (intent.content !== comment.body || intent.creationId !== input.creationId))
    fail("This comment operation has different text. Reopen it before saving.", 409, "CONFLICT");
  let dispatched = intent;
  if (!dispatched) {
    const athlete = await request("/athlete/0");
    if (athlete?.id == null)
      fail("The connected athlete could not be verified before posting your comment.");
    dispatched = {
      content: comment.body,
      creationId: input.creationId,
      beforeIds: before.map((item) => item.provider_id),
      dispatchedAt: now.toISOString(),
      athleteId: String(athlete.id),
    };
    await persistIntent(dispatched);
    try {
      const response = await request(pathFor(input.workoutId), {
        method: "POST",
        body: JSON.stringify({ content: comment.body }),
      });
      if (response?.id != null) {
        dispatched = { ...dispatched, providerId: String(response.id) };
        await persistIntent(dispatched);
      }
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && error.status !== 408) {
        // A definite denial did not create a message. Explicit retry after a
        // repaired connection can submit the same retained intent safely.
        await persistIntent(null);
        throw error;
      }
      // Unknown outcomes retain the durable dispatch marker for readback.
    }
  }
  const after = await loadNativeActivityComments(request, input.workoutId);
  const candidates = after.filter(
    (item) =>
      item.body === dispatched.content &&
      (dispatched.providerId
        ? item.provider_id === dispatched.providerId
        : !dispatched.beforeIds.includes(item.provider_id) &&
          dispatched.athleteId != null &&
          String(item.athlete_id) === dispatched.athleteId)
  );
  if (candidates.length !== 1)
    fail(
      "Your comment is retained. Intervals.icu has not uniquely confirmed it; the app will check again without posting a duplicate."
    );
  return { ...candidates[0], creation_id: input.creationId, comments: after, verified: true };
}
