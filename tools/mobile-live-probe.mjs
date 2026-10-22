// Read-only live smoke check. Only authentication writes; never changes diary/workouts.
import fs from "node:fs/promises";
const origin = "https://training-agent-omega.vercel.app";
const phase = process.env.MOBILE_LIVE_PHASE || "before";
const output = { origin, phase, checkedAt: new Date().toISOString(), checks: [] };
let cookie = "";
try {
  const html = await fetch(origin, { signal: AbortSignal.timeout(20000) }).then((r) => r.text());
  output.assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:js|css))"/g)].map(
    (m) => m[1]
  );
  const password = process.env.APP_PASSWORD || process.env.COACH_ACCESS_PASSWORD;
  if (!password)
    throw Error("Existing app password is unavailable for authenticated smoke checks.");
  const auth = await fetch(origin + "/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ password, remember: false }),
    signal: AbortSignal.timeout(20000),
  });
  output.checks.push({ kind: "authentication", status: auth.status });
  if (!auth.ok) throw Error("Existing configured password could not authenticate.");
  cookie = auth.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  for (const [kind, url] of [
    ...(process.env.MOBILE_LIVE_STARTUP === "1" ? [["home-data", "/api/training-context?scope=full"]] : []),
    ["nutrition", `/api/nutrition?date=${date}`],
    ["food-search", "/api/nutrition/search?q=oats"],
  ].filter(([kind]) => kind !== "nutrition" || process.env.MOBILE_LIVE_SKIP_DIARY !== "1")) {
    const start = performance.now();
    try {
      const r = await fetch(origin + url, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(25000),
        }),
        body = await r.json();
      output.checks.push({
        kind,
        status: r.status,
        totalMs: Math.round(performance.now() - start),
        serverTiming: r.headers.get("server-timing"),
        ...(r.ok
          ? { count: body.products?.length ?? body.day?.entries?.length }
          : {
              error: typeof body.error === "string" ? body.error : "Invalid response",
              providerCode: body.providerCode,
            }),
      });
    } catch (error) {
      output.checks.push({
        kind,
        error: error.name,
        totalMs: Math.round(performance.now() - start),
      });
    }
  }
} catch (error) {
  output.blocker = error.message;
} finally {
  if (cookie)
    await fetch(origin + "/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
      body: "{}",
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  await fs.mkdir("artifacts/mobile-stability", { recursive: true });
  await fs.writeFile(
    `artifacts/mobile-stability/live-${phase}.json`,
    JSON.stringify(output, null, 2) + "\n"
  );
  console.log(JSON.stringify(output));
}
