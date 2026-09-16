// Isolated test API: in-memory events only. Never reads credentials or calls ICU.
// Run with: node tools/workout-editor-preview.mjs
// Then: cd ui; npx vite --config tests/workout-editor.vite.config.ts
import http from "node:http";
import {
  fakeProvider,
  fixtureEvent,
} from "../app-backend/lib/fixtures/workout-editor-fixtures.mjs";
import {
  loadWorkoutEditor,
  saveWorkoutEditor,
  loadNewWorkoutEditor,
  createWorkoutEditor,
} from "../app-backend/lib/workout-editor.mjs";
import { mapIntervalsWorkout } from "../app-backend/lib/intervals.mjs";
let provider = fakeProvider(fixtureEvent()),
  offline = false;
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost"),
      route = url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    };
    try {
      if (route === "test/reset") {
        provider = fakeProvider(fixtureEvent(url.searchParams.get("sport") || "Ride"));
        offline = false;
        return json(200, mapIntervalsWorkout(provider.event(), "2026-09-16"));
      }
      if (route === "test/offline") {
        offline = !offline;
        return json(200, { offline });
      }
      if (route === "test/conflict") {
        provider.setEvent({
          ...provider.event(),
          name: "New remote title",
          updated: new Date().toISOString(),
        });
        return json(200, { changed: true });
      }
      if (route === "test/preview")
        return json(200, mapIntervalsWorkout(provider.event(), "2026-09-16"));
      if (route === "workouts/new/editor")
        return json(
          200,
          await loadNewWorkoutEditor(provider.request, url.searchParams.get("date"))
        );
      if (route === "workouts/editor" && req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const result = await createWorkoutEditor(
          provider.request,
          JSON.parse(Buffer.concat(chunks)),
          "isolated-test"
        );
        return json(200, { ...result, workout: mapIntervalsWorkout(result.event, "2026-09-16") });
      }
      if (/^workouts\/event(?::|%3A)\d+\/editor$/.test(route)) {
        const id = decodeURIComponent(route.split("/")[1]);
        if (offline) return json(503, { error: "Simulated offline save. Your draft is retained." });
        if (req.method === "GET") return json(200, await loadWorkoutEditor(provider.request, id));
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const input = JSON.parse(Buffer.concat(chunks));
        const result = await saveWorkoutEditor(provider.request, id, input, "isolated-test");
        return json(200, { ...result, workout: mapIntervalsWorkout(result.event, "2026-09-16") });
      }
      json(404, { error: "Isolated test API: unsupported route" });
    } catch (e) {
      json(e.status || 500, { error: e.message, code: e.code });
    }
  })
  .listen(4185, "127.0.0.1", () =>
    console.log("Isolated workout editor API: http://127.0.0.1:4185")
  );
