// Isolated browser fixture. Serves the built app with synthetic, local-only APIs.
// No request is forwarded to Supabase, Intervals.icu, GitHub, or another service.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve("ui/dist");
const port = Number(process.env.INTERVALS_PREVIEW_PORT || 5178);
const calls = [];
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const raceDate = new Date(`${today}T12:00:00Z`);
raceDate.setUTCDate(raceDate.getUTCDate() + 60);
const raceDay = raceDate.toISOString().slice(0, 10);
const context = {
  athlete: { name: "Browser test athlete", time_zone: "America/Chicago", zones: {} },
  metrics: { fitness: 77, fatigue: 68, form: 9 },
  wellness: { hrv: 59, resting_hr: 54, sleep: 26040 },
  history: [],
  planned: [
    {
      id: "event:fixture-today",
      day: today,
      date: today,
      workout_date: today,
      sport: "Run",
      title: "Easy aerobic run",
      duration: "45m",
      plannedDurationMinutes: 45,
      goal: "Keep the effort conversational and finish feeling fresh.",
      status: "today",
      category: "WORKOUT",
      planned: { duration_minutes: 45, tss: 42 },
    },
    {
      id: "event:fixture-a-race",
      day: raceDay,
      date: raceDay,
      workout_date: raceDay,
      sport: "Triathlon",
      title: "Texas City Triathlon",
      duration: "Race",
      goal: "A race",
      status: "upcoming",
      category: "RACE_A",
      raw: { category: "RACE_A", priority: "A", name: "Texas City Triathlon" },
    },
  ],
  wellness_history: Array.from({ length: 14 }, (_, index) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 13 + index);
    return {
      date: date.toISOString().slice(0, 10),
      hrv: 54 + ((index * 7) % 13),
      resting_hr: 52 + ((index * 3) % 7),
      sleepSecs: 25200 + ((index * 23) % 1800),
      sleepScore: 74 + ((index * 5) % 20),
    };
  }),
  source: "isolated-browser-fixture",
  context_scope: "full",
  version: "fixture-v1",
  cache_scope: "webhook-browser-fixture",
  synced_at: new Date().toISOString(),
};
let configured = false;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const json = (body, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/_test/calls") return json(calls);
  if (url.pathname.startsWith("/api/")) {
    const api = url.searchParams.get("__api_route") || url.pathname.slice(5);
    calls.push({ api, method: req.method });
    if (api === "auth/session")
      return json({
        configured: true,
        authenticated: true,
        hasPasskey: false,
        passkeysSupported: false,
      });
    if (api === "config") {
      if (req.method === "POST") {
        for await (const _chunk of req) {
          /* discard fixture values */
        }
        configured = true;
      }
      return json({ theme: "light", intervalsConnected: true, supabaseConnected: false });
    }
    if (api === "intervals/status")
      return json({
        apiConnected: true,
        oauthConfigured: configured,
        oauthConnected: false,
        scopesComplete: false,
        webhookConfigured: true,
        clientId: "1250",
        webhookUrl: "https://training-agent-omega.vercel.app/api/intervals/webhook",
        redirectUri: "https://training-agent-omega.vercel.app/api/intervals/oauth/callback",
        lastDeliveryAt: null,
        lastReceivedAt: null,
        lastSyncedAt: context.synced_at,
        pending: false,
      });
    if (api === "training-context") return json(context);
    if (api === "training-live")
      return json({ available: false, url: "", key: "", topic: "", expiresAt: 0 });
    if (api === "training-updates") return json({ unchanged: true, version: context.version });
    if (api === "annual-plans") return json({ plans: [], activeId: null });
    if (api === "race-events") return json({ events: [] });
    if (api.startsWith("nutrition")) {
      const date = url.searchParams.get("date") || today;
      const targets = { calories: 2400, protein: 150, carbs: 280, fat: 75, fiber: 30 };
      return json({
        date,
        day: { revision: 1, entries: [] },
        targets,
        targetsRevision: 1,
        aiAvailable: false,
        localPreview: true,
        week: [],
      });
    }
    if (api === "training-history") return json({ weeks: [] });
    if (api === "section11-sync") return json({ status: "idle" });
    if (api === "intervals/oauth/start")
      return json({ url: `http://127.0.0.1:${port}/settings?intervals=permissions` });
    return json({ error: "Endpoint not available in the isolated browser fixture" }, 404);
  }
  try {
    const filename =
      url.pathname === "/" || !path.extname(url.pathname)
        ? "index.html"
        : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const target = path.resolve(root, filename);
    if (!target.startsWith(root + path.sep)) return json({ error: "Invalid path" }, 400);
    const data = await fs.readFile(target);
    res.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".woff2": "font/woff2",
          ".png": "image/png",
          ".svg": "image/svg+xml",
        }[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    json({ error: "Not found" }, 404);
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Isolated fixture ready at http://127.0.0.1:${port}/settings?intervals=setup`)
);
