// Persistent local preview. Never imports a backend, credentials, or environment file.
// Run: node tools/desktop-preview.mjs; stop with Ctrl+C.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopPreviewFixtures, validDate } from "./desktop-preview-fixtures.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(workspace, "ui", "dist"),
  port = 5194,
  host = "127.0.0.1";
const fixture = createDesktopPreviewFixtures();
const csp =
  "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
const browserGuard = `<script id="local-preview-guard">(()=>{
  const local=value=>{const url=new URL(value,location.href);return url.origin===location.origin&&(url.protocol==='http:'||url.protocol==='https:')};
  const blocked=()=>new Error('External requests are disabled in the synthetic local preview.');
  const originalFetch=window.fetch.bind(window);window.fetch=(input,options)=>local(input instanceof Request?input.url:String(input))?originalFetch(input,options):Promise.reject(blocked());
  const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){if(!local(String(url)))throw blocked();return open.call(this,method,url,...rest)};
  for(const name of ['WebSocket','EventSource','Worker','SharedWorker']){const Constructor=window[name];if(!Constructor)continue;window[name]=new Proxy(Constructor,{construct(Target,args){if(!local(String(args[0])))throw blocked();return Reflect.construct(Target,args)}})}
  if(navigator.sendBeacon){const beacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=(url,data)=>local(String(url))?beacon(url,data):false;}
  const originalOpen=window.open.bind(window);window.open=(url,...args)=>!url||local(String(url))?originalOpen(url,...args):null;
  document.addEventListener('click',event=>{const link=event.target instanceof Element?event.target.closest('a[href]'):null;if(link&&!local(link.href))event.preventDefault()},true);
  const theme=new URLSearchParams(location.search).get('theme');if(['light','dark','system'].includes(theme)){try{localStorage.setItem('theme',theme)}catch{}}
  window.__localPreview={synthetic:true,readOnly:true};
})();</script>`;
const safeWorker =
  "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));";
const readPosts = new Set(["training-live", "coach/reports/catalog", "coach/reports/status"]);
const apiReply = (api, url) => {
  if (api === "auth/session")
    return { configured: true, authenticated: true, hasPasskey: false, passkeysSupported: false };
  if (api === "config")
    return {
      intervalsConnected: true,
      supabaseConnected: false,
      calendarSummaryOpen: true,
      localPreview: true,
      readOnly: true,
    };
  if (api === "training-live") return { available: false };
  if (api === "training-context" || api === "training-updates") {
    const scope = url.searchParams.get("scope"),
      start = url.searchParams.get("start"),
      end = url.searchParams.get("end");
    if (
      scope === "range" &&
      (!validDate(start) ||
        !validDate(end) ||
        start > end ||
        (Date.parse(end) - Date.parse(start)) / 86400000 > 370)
    )
      return { error: "Invalid preview date range" };
    const context = scope === "range" ? fixture.context(start, end, "range") : fixture.context();
    return api === "training-updates"
      ? { unchanged: false, version: fixture.version, context }
      : context;
  }
  if (api === "annual-plans") return fixture.annualPlans;
  if (api === "training-history") return { weeks: [] };
  if (api === "race-events") return { events: fixture.events };
  if (api === "section11-sync" || api === "section11-export")
    return { status: "complete", version: fixture.version };
  if (api === "nutrition")
    return fixture.nutrition(
      validDate(url.searchParams.get("date")) ? url.searchParams.get("date") : fixture.today
    );
  if (api === "nutrition/library") return { revision: 1, items: [] };
  if (api === "coach/session")
    return {
      configured: false,
      authenticated: false,
      missing: ["This preview has no AI/provider connection."],
      calendar: { available: false, timeZone: "America/Chicago" },
    };
  if (api === "coach/reports/catalog") return { reports: [] };
  if (api === "coach/reports/status") return { status: "not_requested", eligible: false };
  if (api === "personal-statistics")
    return fixture.personalStatistics(
      url.searchParams.get("oldest"),
      url.searchParams.get("newest") || fixture.today
    );
  if (api === "performance-history")
    return fixture.performanceHistory(url.searchParams.get("type") || "Ride");
  const historyWorkout = api.match(/^workout-history\/([^/]+)$/);
  if (historyWorkout) {
    const id = decodeURIComponent(historyWorkout[1]).replace(/^activity:/, "");
    const workout = fixture.lookup(id);
    return workout
      ? { workout, source: "synthetic-local-preview" }
      : { error: "This synthetic recording is unavailable." };
  }
  const activity = api.match(/^activities\/([^/]+)\/(summary|analysis|route|performance-effort)$/);
  if (activity) {
    const id = decodeURIComponent(activity[1]);
    if (activity[2] === "performance-effort")
      return fixture.performanceEffort(
        id,
        url.searchParams.get("type"),
        Number(url.searchParams.get("duration")),
        Number(url.searchParams.get("distance"))
      );
    if (activity[2] === "route") return { points: [] };
    if (activity[2] === "summary") return fixture.lookup(id)?.workout_summary.completed || null;
    return fixture.analysis(id);
  }
  return null;
};

const server = http.createServer(async (request, response) => {
  response.setHeader("Content-Security-Policy", csp);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  const json = (value, status = 200) => {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(value));
  };
  try {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host))
      return json({ error: "Use this preview on localhost only." }, 403);
    if (
      request.headers.origin &&
      !["http://127.0.0.1:" + port, "http://localhost:" + port].includes(request.headers.origin)
    )
      return json({ error: "Cross-origin requests are disabled." }, 403);
    const url = new URL(request.url, `http://${host}:${port}`);
    if (url.pathname.startsWith("/api/")) {
      const api = url.searchParams.get("__api_route") || url.pathname.slice(5);
      if (request.method !== "GET" && !(request.method === "POST" && readPosts.has(api)))
        return json({ error: "Synthetic preview: saving and provider actions are disabled." }, 405);
      request.resume();
      const value = apiReply(api, url);
      return json(
        value || { error: "This endpoint is unavailable in the synthetic preview." },
        value === null ? 404 : value.error ? 400 : 200
      );
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      return json({ error: "Preview files are read-only." }, 405);
    if (url.pathname === "/sw.js") {
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Service-Worker-Allowed": "/",
      });
      return response.end(request.method === "HEAD" ? undefined : safeWorker);
    }
    if (url.pathname === "/__preview/health")
      return json({ synthetic: true, readOnly: true, port, today: fixture.today, backend: false });
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes("\\") || decoded.includes("\0") || decoded.split("/").includes(".."))
      return json({ error: "Invalid path" }, 400);
    const filename =
      decoded === "/" || !path.extname(decoded) ? "index.html" : decoded.replace(/^\/+/, "");
    const target = path.resolve(dist, filename);
    if (!target.startsWith(dist + path.sep)) return json({ error: "Invalid path" }, 400);
    const real = await fs.realpath(target),
      realDist = await fs.realpath(dist);
    if (!real.startsWith(realDist + path.sep)) return json({ error: "Invalid file" }, 400);
    let data = await fs.readFile(real);
    if (filename === "index.html")
      data = Buffer.from(
        data
          .toString("utf8")
          .replace(/<head>/i, `<head>${browserGuard}`)
          .replace(/<title>[^<]*<\/title>/i, "<title>Local fake data · AR Performance</title>")
      );
    const contentType =
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".ttf": "font/ttf",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".webmanifest": "application/manifest+json",
      }[path.extname(target)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch (error) {
    return json(
      {
        error:
          error?.code === "ENOENT"
            ? "Build the UI before opening this local preview."
            : "Preview request could not be read.",
      },
      error?.code === "ENOENT" ? 404 : 400
    );
  }
});
server.on("error", (error) => {
  console.error(`Local preview could not start: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () =>
  console.log(
    `Synthetic read-only preview: http://${host}:${port}/calendar\nLight: http://${host}:${port}/calendar?theme=light\nDark: http://${host}:${port}/calendar?theme=dark\nNo database, backend, credentials or provider connection. Stop with Ctrl+C.`
  )
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
