// Persistent local preview. Never starts the backend server or loads credentials.
// --calendar-edits enables disposable calendar and nutrition editing in memory.
// Run: node tools/desktop-preview.mjs [--calendar-edits]; stop with Ctrl+C.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopPreviewFixtures, validDate } from "./desktop-preview-fixtures.mjs";
import { createDesktopCalendarPreview } from "./desktop-calendar-preview-fixtures.mjs";
import { createDesktopNutritionPreview } from "./desktop-nutrition-preview-fixtures.mjs";
import { createWorkoutPersonalService } from "../app-backend/lib/workout-personal.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewDist = process.argv.find(arg => arg.startsWith("--dist="))?.slice(7);
const dist = path.resolve(workspace, previewDist || "ui/dist"),
  port = Number(process.argv.find(arg => arg.startsWith("--port="))?.slice(7)) || (process.argv.includes("--calendar-edits") ? 5195 : 5194),
  host = "127.0.0.1";
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local preview port");
if (!dist.startsWith(workspace + path.sep)) throw new Error("Preview files must stay inside this workspace.");
// Explicit fault timing for skeleton/retry QA; no delay is enabled by default.
const delayMs = Number(process.argv.find(arg => arg.startsWith("--delay-ms="))?.slice(11)) || 0;
const delayedApis = (process.argv.find(arg => arg.startsWith("--delay-api="))?.slice(12) || "activities/").split(",");
const delayWrites = process.argv.includes("--delay-writes");
let rejectNutritionOnce = process.argv.includes("--reject-nutrition-once");
let rejectWorkoutEditOnce = process.argv.includes("--reject-workout-edit-once");
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 15000) throw new Error("Invalid preview delay");
const fixture = createDesktopPreviewFixtures(new Date(), { gps: !process.argv.includes("--no-gps") });
const calendarPreview = process.argv.includes("--calendar-edits")
  ? createDesktopCalendarPreview(fixture, {loseCreateResponseOnce: process.argv.includes("--lose-create-response-once"),loseCopyResponseOnce:process.argv.includes("--lose-copy-response-once"),rejectMoveOnce:process.argv.includes("--reject-move-once"),staleWorkoutClaims:process.argv.includes("--stale-workout-claims"),loseLibraryScheduleResponseOnce:process.argv.includes("--lose-library-schedule-response-once"),loseCoachScheduleResponseOnce:process.argv.includes("--lose-coach-schedule-response-once")})
  : null;
const nutritionPreview = calendarPreview ? createDesktopNutritionPreview(fixture) : null;
const personalRecords = new Map();
const personalPreview = createWorkoutPersonalService({
  record: (key, fresh) => ({
    async read() { return structuredClone(personalRecords.get(key) || fresh()); },
    async update(change) {
      const state = structuredClone(personalRecords.get(key) || fresh()), result = change(state);
      personalRecords.set(key, state);
      return result;
    },
  }),
  authorizeWorkout: async id => {
    if (!(calendarPreview || fixture).lookup(id)) throw Object.assign(Error("Workout not found."), { status: 404 });
  },
});
const csp =
  "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
const browserGuard = `<script id="local-preview-guard">(()=>{
  const local=value=>{const url=new URL(value,location.href);return url.origin===location.origin&&['http:','https:','blob:'].includes(url.protocol)};
  const blocked=()=>new Error('External requests are disabled in the synthetic local preview.');
  const originalFetch=window.fetch.bind(window);window.fetch=(input,options)=>local(input instanceof Request?input.url:String(input))?originalFetch(input,options):Promise.reject(blocked());
  const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){if(!local(String(url)))throw blocked();return open.call(this,method,url,...rest)};
  for(const name of ['WebSocket','EventSource','Worker','SharedWorker']){const Constructor=window[name];if(!Constructor)continue;window[name]=new Proxy(Constructor,{construct(Target,args){if(!local(String(args[0])))throw blocked();return Reflect.construct(Target,args)}})}
  if(navigator.sendBeacon){const beacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=(url,data)=>local(String(url))?beacon(url,data):false;}
  const originalOpen=window.open.bind(window);window.open=(url,...args)=>!url||local(String(url))?originalOpen(url,...args):null;
  document.addEventListener('click',event=>{const link=event.target instanceof Element?event.target.closest('a[href]'):null;if(link&&!local(link.href))event.preventDefault()},true);
  const theme=new URLSearchParams(location.search).get('theme');if(['light','dark','system'].includes(theme)){try{localStorage.setItem('theme',theme)}catch{}}
  window.__localPreview={synthetic:true,readOnly:${!calendarPreview}};
})();</script>`;
const safeWorker =
  "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));";
const benchmarkGuard = `<script>(()=>{
  if(new URLSearchParams(location.search).get('benchmark')!=='1')return;
  const fetch=window.fetch.bind(window);
  let settingsReady=false;
  window.fetch=(input,options)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href),api=url.searchParams.has('__api_route')?'/api/'+url.searchParams.get('__api_route'):url.pathname,start=performance.now();return fetch(input,options).then(response=>{if(api.startsWith('/api/'))void response.clone().text().then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    console.info('[api-benchmark]',JSON.stringify({api,ms:Math.round(performance.now()),durationMs:Math.round(performance.now()-start)}));
    if(location.pathname==='/settings'&&api==='/api/race-events'&&!settingsReady){settingsReady=true;document.documentElement.dataset.previewSettingsReady='true';console.info('[startup-benchmark]',JSON.stringify({page:'settings',ms:Math.round(performance.now())}));}
  }))).catch(()=>{});return response;});};
  let click=null;
  document.addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest('button,a,[role="tab"],[role="button"]'):null;if(target)click={label:target.getAttribute('aria-label')||target.textContent.trim().slice(0,70),start:performance.now(),phases:new Set()};},true);
  const interaction=()=>{
    if(!click)return;
    const field=document.querySelector('[role="dialog"] input[aria-label="Planned duration"]');
    for(const [phase,ready] of [['popup-visible',document.querySelector('[role="dialog"] .desktop-workout-header')],['planned-editable',field&&!field.disabled],['analysis-ready',document.querySelector('.analysis-charts svg')],['analysis360-ready',document.querySelector('.a360-signal-canvas svg')],['mobile-workout-visible',document.querySelector('.planned-workout-mobile-page,[data-workout-sheet-title]')],['nutrition-ready',location.pathname==='/nutrition'&&document.querySelector('.nutrition-progress-card')]]){
      if(ready&&!click.phases.has(phase)){click.phases.add(phase);console.info('[interaction-benchmark]',JSON.stringify({label:click.label,phase,ms:Math.round(performance.now()-click.start)}));}
    }
  };
  new MutationObserver(interaction).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
  const kind=location.pathname.split('/').filter(Boolean).join('/')||'home';
  const observer=new MutationObserver(()=>{
    const ready=kind==='nutrition'?document.querySelector('.nutrition-progress-card'):kind==='calendar'?document.querySelector('.calendar-workout-card,button[aria-label^="Open "]'):kind==='coach'?document.querySelector('.coach-week-report-groups button'):kind==='library'?(document.querySelector('[data-workout-id]')||[...document.querySelectorAll('[role="button"],button')].find(node=>node.textContent.startsWith('Preview aerobic run'))):['atp','annual-plan'].includes(kind)?document.querySelector('#annual-plan-week-layer input[aria-label="Planned hours"],.annual-plan-blocks-scroller button'):kind==='settings'?false:kind==='workout-reports'?(document.querySelector('[aria-label="Workout report table"]')&&[...document.querySelectorAll('button')].some(node=>node.textContent.trim()==='Columns'&&!node.disabled)):document.querySelector('.home-athlete-name');
    if(!ready)return;
    console.info('[startup-benchmark]',JSON.stringify({page:kind,ms:Math.round(performance.now())}));observer.disconnect();
  });observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
})();</script>`;
const readPosts = new Set(["training-live", "coach/reports/catalog", "coach/reports/status"]);
let calendarSummaryOpen = true;
const apiReply = (api, url) => {
  if (api === "auth/session")
    return { configured: true, authenticated: true, hasPasskey: false, passkeysSupported: false };
  if (api === "config")
    return {
      intervalsConnected: true,
      supabaseConnected: false,
      calendarSummaryOpen,
      localPreview: true,
      readOnly: !calendarPreview,
    };
  if (api === "training-live") return { available: false };
  if (api === "intervals/status") return {apiConnected:true,oauthConfigured:false,oauthConnected:false,scopesComplete:false,webhookConfigured:false,lastDeliveryAt:null,lastSyncedAt:null,lastError:null,pending:false};
  if (api === "sync") return { context:(calendarPreview || fixture).context(), queue:{synced:0,failed:0,pending:0,unknown:0} };
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
    const source = calendarPreview || fixture;
    const context = scope === "range" ? source.context(start, end, "range") : source.context();
    return api === "training-updates"
      ? { unchanged: false, version: source.version, context }
      : context;
  }
  if (api === "annual-plans") return fixture.annualPlans;
  if (api === "workout-library") return {workouts:fixture.context().planned.slice(0,8).map((workout,index)=>({...workout,id:`library:preview-${index}`,title:index===0?'Preview aerobic run':workout.title}))};
  if (api === "training-history") return { weeks: [] };
  if (api === "training-preferences") return {training_preferences:{}};
  if (api === "workout-history") return {workouts:(calendarPreview || fixture).context().history.filter(workout=>(!url.searchParams.get('start')||workout.workout_date>=url.searchParams.get('start'))&&(!url.searchParams.get('end')||workout.workout_date<=url.searchParams.get('end'))),next_before:null,complete:true};
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
  if (api === "coach/reports/catalog") return { reports: [{id:'preview-pre-workout',kind:'pre_workout',title:'Preview workout preparation',startDate:fixture.today,endDate:fixture.today,text:'## Workout preparation\n\nThis report uses synthetic local data.\n\n- Start easy\n- Keep the effort controlled',sport:'Run',source:'app'}] };
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
    const workout = (calendarPreview || fixture).lookup(id);
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
    const source = calendarPreview || fixture;
    if (activity[2] === "route") return { points: (source.analysis(id)?.points || []).filter(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)).map(point => [point.latitude, point.longitude]) };
    if (activity[2] === "summary") return source.lookup(id)?.workout_summary.completed || null;
    return source.analysis(id);
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
      const personalRoute = api.match(/^workouts\/([^/]+)\/personal(?:\/attachments(?:\/([a-f0-9]{64}))?)?$/i);
      if (personalRoute) {
        if (!calendarPreview && request.method !== "GET") return json({ error: "This synthetic preview is read-only." }, 405);
        const id = decodeURIComponent(personalRoute[1]), attachmentId = personalRoute[2];
        try {
          if (attachmentId && request.method === "GET") {
            const file = await personalPreview.attachment(id, attachmentId);
            response.writeHead(200, { "Content-Type": file.type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` });
            response.end(Buffer.from(file.data, "base64"));return;
          }
          if (attachmentId && request.method === "DELETE") return json(await personalPreview.removeAttachment(id, attachmentId));
          if (request.method === "GET") return json(await personalPreview.read(id));
          const chunks = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 3_000_000) return json({ error: "Attachment request exceeds 2 MB." }, 413);
            chunks.push(chunk);
          }
          const input = JSON.parse(Buffer.concat(chunks).toString() || "{}");
          if (api.endsWith("/attachments") && request.method === "POST") return json(await personalPreview.upload(id, input));
          if (request.method === "PUT") return json(await personalPreview.save(id, input));
          return json({ error: "Method not allowed." }, 405);
        } catch (error) { return json({ error: error.message, code: error.code }, error.status || 500); }
      }
      const calendarWrite = calendarPreview?.canWrite(api, request.method);
      const nutritionWrite = nutritionPreview?.canWrite(api, request.method);
      const preferenceWrite = api === "config" && request.method === "POST";
      if (
        request.method !== "GET" &&
        !calendarWrite &&
        !nutritionWrite &&
        !preferenceWrite &&
        !(request.method === "POST" && (readPosts.has(api) || (api === "sync" && calendarPreview)))
      )
        return json({ error: "Synthetic preview: saving and provider actions are disabled." }, 405);
      let input = {};
      if (calendarWrite || nutritionWrite || preferenceWrite) {
        const chunks = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > (api.startsWith("workout-files/") ? 3_000_000 : 256000)) return json({ error: "Synthetic request is too large." }, 413);
          chunks.push(chunk);
        }
        input = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      } else request.resume();
      if ((request.method === "GET" || readPosts.has(api) || delayWrites) && delayMs && delayedApis.some(prefix=>api.startsWith(prefix))) {
        await new Promise(resolve=>setTimeout(resolve,delayMs));
        if (response.destroyed) return;
      }
      if (nutritionWrite && api === "nutrition/entries" && rejectNutritionOnce) {
        rejectNutritionOnce = false;
        return json({ error: "Synthetic rejected food save. Your entries have not changed." }, 503);
      }
      if (calendarWrite && request.method === "PUT" && /^workouts\/[^/]+\/(editor|planned-values)$/.test(api) && rejectWorkoutEditOnce) {
        rejectWorkoutEditOnce = false;
        return json({error:"Synthetic rejected workout edit. Your draft is retained; the saved workout has not changed."},409);
      }
      if (preferenceWrite) {
        if (!['true','false'].includes(input.CALENDAR_SUMMARY_OPEN) || Object.keys(input).length !== 1)
          return json({ error: 'Only the disposable calendar summary preference is supported.' }, 400);
        calendarSummaryOpen = input.CALENDAR_SUMMARY_OPEN === 'true';
        return json(apiReply('config',url));
      }
      const value =
        nutritionPreview?.handle(api, request.method, input, url) ??
        (await calendarPreview?.handle(api, request.method, input, url)) ?? apiReply(api, url);
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
      return json({
        synthetic: true,
        readOnly: !calendarPreview,
        port,
        today: fixture.today,
        backend: false,
      });
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
          .replace(/<head>/i, `<head>${browserGuard}${benchmarkGuard}`)
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
        ".webp": "image/webp",
        ".webmanifest": "application/manifest+json",
      }[path.extname(target)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch (error) {
    if (calendarPreview && request.url.startsWith("/api/"))
      return json({ error: error.message, code: error.code }, error.status || 500);
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
    `Synthetic ${calendarPreview ? "disposable calendar editing" : "read-only"} preview: http://${host}:${port}/calendar\nLight: http://${host}:${port}/calendar?theme=light\nDark: http://${host}:${port}/calendar?theme=dark\nNo database, backend, credentials or provider connection. Stop with Ctrl+C.`
  )
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
