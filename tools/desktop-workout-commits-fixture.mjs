// Real commit service + serialized in-memory store + synthetic provider only.
// This fixture never demonstrates production database latency or disk durability.
import { createDurableWorkoutCommits } from "../app-backend/lib/durable-workout-commits.mjs";
export function createDesktopWorkoutCommits({ calendar, personal, providerDelayMs = 0 }) {
  let state = { version: 1, workouts: {}, operations: {} },
    tail = Promise.resolve();
  const record = {
    read: async () => structuredClone(state),
    update(change) {
      const result = tail.then(() => {
        const next = structuredClone(state),
          value = change(next);
        state = next;
        return value;
      });
      tail = result.catch(() => {});
      return result;
    },
  };
  const request = async (path, options = {}) => {
    if (options.method && providerDelayMs)
      await new Promise((resolve) => setTimeout(resolve, providerDelayMs));
    if (path === "/athlete/0/events/bulk?upsert=true" && options.method === "POST") {
      const results = [];
      for (const body of JSON.parse(options.body)) {
        const date = body.start_date_local.slice(0, 10),
          rows = await calendar.request(`/athlete/0/events?oldest=${date}&newest=${date}`),
          existing = rows.find((row) => row.external_id === body.external_id);
        results.push(
          await calendar.request(
            existing ? `/athlete/0/events/${existing.id}` : "/athlete/0/events",
            { ...options, method: existing ? "PUT" : "POST", body: JSON.stringify(body) }
          )
        );
      }
      return results;
    }
    return calendar.request(path, options);
  };
  const service = createDurableWorkoutCommits(
    { APP_ORIGIN: "http://localhost:5194", TIME_ZONE: "America/Chicago" },
    {
      record,
      request,
      write: (_id, change) => change(request),
      personalService: personal,
      loadZoneSettings: async () => calendar.context().athlete.sport_settings,
    }
  );
  calendar.setCommentCommitService?.(service);
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      void service.drain().finally(() => {
        scheduled = false;
      });
    }, 0);
  };
  const timer = setInterval(schedule, 500);
  timer.unref();
  return {
    ...service,
    schedule,
    inspect: async () => ({
      ...(await service.status()),
      store: structuredClone(state),
      synthetic: true,
      durableBoundary: "in-memory-test-double",
    }),
  };
}
