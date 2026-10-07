import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { changeHint } from './intervals-change-hints.mjs';

export const WEBHOOK_TYPES = new Set([
  "ACTIVITY_UPLOADED",
  "ACTIVITY_ANALYZED",
  "ACTIVITY_UPDATED",
  "ACTIVITY_DELETED",
  "ACTIVITY_ACHIEVEMENTS",
  "WELLNESS_UPDATED",
  "FITNESS_UPDATED",
  "CALENDAR_UPDATED",
  "SPORT_SETTINGS_UPDATED",
  "APP_SCOPE_CHANGED",
  "CONNECTED_SERVICE",
]);
export function secretMatches(received, expected) {
  if (typeof received !== "string" || !received || typeof expected !== "string" || !expected)
    return false;
  const hash = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(received), hash(expected));
}
export const freshWebhookState = () => ({ revision: 0, completed: 0, deliveries: [], lease: null });

// Acknowledgement follows a durable inbox write. A lease serializes refreshes
// across instances; revisions retain events arriving while a refresh is running.
// Payloads are hints only: re-read the API so delayed updates cannot resurrect deletes.
export function createWebhookSync({ store, refresh, now = Date.now, reconcileMs = 900_000 }) {
  return {
    async accept(events, athleteId) {
      const relevant = events.filter(
        (event) => WEBHOOK_TYPES.has(event?.type) && String(event.athlete_id) === String(athleteId)
      );
      const hashes = relevant.map((event) =>
        createHash("sha256").update(JSON.stringify(event)).digest("hex")
      );
      return store.update((state) => {
        const time = now();
        state.lastDeliveryAt = new Date(time).toISOString();
        state.deliveries = (state.deliveries || []).filter((entry) => time - entry.at < 86_400_000);
        const seen = new Set(state.deliveries.map((entry) => entry.id));
        const added = [...new Set(hashes)].filter((id) => !seen.has(id));
        if (added.length) {
          state.revision++;
          const hints = relevant.filter((_, index) => added.includes(hashes[index])).map(changeHint);
          state.changes = [...(state.changes || []), { revision: state.revision, hints }];
          if (state.changes.reduce((n, change) => n + change.hints.length, 0) > 100)
            state.changes = [{ revision: state.revision, hints: [{ full: true }] }];
          state.lastReceivedAt = new Date(time).toISOString();
          state.deliveries.push(...added.map((id) => ({ id, at: time })));
          state.deliveries = state.deliveries.slice(-512);
        }
        return relevant.length
          ? { accepted: added.length, duplicate: added.length === 0 }
          : { accepted: 0 };
      });
    },
    async drain() {
      // Read-only fast path avoids database writes on each browser poll.
      const current = await store.read();
      const due = (state) =>
        state.revision > state.completed || now() - (state.lastChecked || 0) >= reconcileMs;
      if (!due(current) || current.lease?.until > now()) return;
      if (current.retryAt > now()) return { retryAt: current.retryAt };
      for (let pass = 0; pass < 3; pass++) {
        const token = randomUUID();
        const claim = await store.update((state) => {
          if (!due(state) || state.retryAt > now() || state.lease?.until > now()) return null;
          state.lease = { token, until: now() + 240_000 };
          return { revision: state.revision, hints: (state.changes || [])
            .filter(change => change.revision > state.completed).flatMap(change => change.hints) };
        });
        if (!claim) return;
        try {
          await refresh({ hints: claim.hints });
          const more = await store.update((state) => {
            if (state.lease?.token !== token) return false;
            state.completed = Math.max(state.completed, claim.revision);
            state.changes = (state.changes || []).filter(change => change.revision > state.completed);
            state.lastChecked = now();
            state.lastSyncedAt = new Date(now()).toISOString();
            state.lastError = null;
            state.failures = 0;
            state.retryAt = 0;
            state.lease = null;
            return state.revision > state.completed;
          });
          if (!more) return;
        } catch {
          const retryAt = await store.update((state) => {
            if (state.lease?.token !== token) return;
            state.lease = null;
            state.failures = (state.failures || 0) + 1;
            state.retryAt =
              now() + Math.min(300_000, 15_000 * 2 ** Math.min(state.failures - 1, 5));
            state.lastError =
              "Intervals.icu refresh failed. Saved data is available; the next delivery or app check will retry.";
            return state.retryAt;
          });
          return retryAt ? { retryAt } : undefined;
        }
      }
      return { retryAt: now() + 1000 };
    },
    async status() {
      const state = await store.read();
      return {
        lastDeliveryAt: state.lastDeliveryAt || null,
        lastReceivedAt: state.lastReceivedAt || null,
        lastSyncedAt: state.lastSyncedAt || null,
        pending: state.revision > state.completed,
        lastError: state.lastError || null,
      };
    },
  };
}
