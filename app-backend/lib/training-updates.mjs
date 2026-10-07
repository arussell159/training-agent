import { athleteLocalDate } from "./athlete-date.mjs";
import { fetchIntervalsContext } from "./intervals.mjs";
import { mergeTrainingSnapshot, providerConnection } from "./completed-workout-store.mjs";
import { prepareFastView, projectTrainingContext } from "./fast-context.mjs";
import { changedTrainingRange } from './intervals-change-hints.mjs';

// A foreground check bypasses the broad sync, file archive and GitHub worker.
// Only changed content is written. Concurrent opens share the provider check.
export function createTrainingUpdates({
  readSnapshot,
  request,
  persist,
  warm,
  exportGithub,
  waitUntil,
  now = () => new Date(),
  log = () => {},
}) {
  const checks = new Map();
  const profiles = new Map();
  return async (config, { durable = false, full = false, hints } = {}) => {
    const key = providerConnection(config),
      time = now();
    const current = checks.get(key);
    if (current && !durable && time.getTime() - current.at < 2000) return current.promise;
    if (current && durable) await current.promise.catch(() => {});
    const entry = { at: time.getTime(), promise: null };
    entry.promise = (async () => {
      // Another Vercel instance may have just saved the preceding webhook.
      // A targeted merge must start from that commit, never a 30-second cache.
      const saved = await readSnapshot(config, { fresh: durable });
      const zone = saved?.athlete?.time_zone || "America/Chicago";
      const today = athleteLocalDate(time, zone);
      const shift = (n) =>
        new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
      const changedRange = changedTrainingRange(saved, hints);
      const range = changedRange || (saved && !full ? { start: shift(-7), end: shift(60) } : undefined);
      const provider = request(config);
      let profile = profiles.get(key);
      if (changedRange) {
        profile = { promise: Promise.resolve(saved.athlete) };
      } else if (!profile || full || time.getTime() - profile.at >= 300_000) {
        profile = { at: time.getTime(), promise: provider("/athlete/0") };
        profiles.set(key, profile);
        if (profiles.size > 8) profiles.delete(profiles.keys().next().value);
      }
      let athlete;
      try {
        athlete = await profile.promise;
      } catch (error) {
        profiles.delete(key);
        throw error;
      }
      const incoming = await fetchIntervalsContext(provider, {
        now: time,
        timeZone: zone,
        range,
        includeFutureRaces: !changedRange,
        wellnessLookbackDays: changedRange ? 0 : 29,
        cachedAthlete: athlete,
      });
      const merged = mergeTrainingSnapshot(saved, incoming, range);
      const context = prepareFastView(config, merged);
      const previous = saved ? prepareFastView(config, saved) : null;
      const changed = !previous || previous.version !== context.version;
      // Webhook jobs must not mark their revision complete until persistence
      // succeeds. Optional recording preparation/GitHub export stay off that path.
      if (durable) await persist(config, merged);
      const task = (async () => {
        if (!durable && changed) await persist(config, merged);
        // New/corrected recordings are prepared before they are opened.
        await Promise.all([warm(config, merged), exportGithub(config, context)]);
      })().catch((error) => log(`Background training preparation: ${error.message}`));
      waitUntil(task);
      return { context: projectTrainingContext(context, "full"), sourceChanged: changed };
    })().catch((error) => {
      if (checks.get(key) === entry) checks.delete(key);
      throw error;
    });
    checks.set(key, entry);
    if (checks.size > 8) checks.delete(checks.keys().next().value);
    return entry.promise;
  };
}
