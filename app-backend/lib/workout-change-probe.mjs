import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { completedIds } from "./workout-sync-policy.mjs";

const PURPOSE = "training-mirror-change-hint-v2";
const COOKIE = "training_app_session";
const MAX_BODY = 128000;
const MAX_SESSION = 90 * 86400000;
const hash = (value) => createHash("sha256").update(value).digest("base64url");
const fail = (message, status = 401) => Object.assign(new Error(message), { status });

function normalizedPlanned(rows = [], source = "app") {
  return rows
    .filter((row) => row && (source === "mirror" || !row.completed))
    .map((row) => {
      if (source === "mirror") {
        return {
          id: String(row.id ?? ""),
          date: String(row.date || "").slice(0, 10),
          name: String(row.name || ""),
          sport: String(row.sport_type || ""),
          category: String(row.type || ""),
          duration: Number.isFinite(Number(row.duration_hours))
            ? Math.round(Number(row.duration_hours) * 3600)
            : null,
          tss: row.planned_tss ?? null,
        };
      }
      const raw = row.raw || {};
      const fallbackId = String(row.id || "").replace(/^event:/, "");
      return {
        id: String(raw.id ?? fallbackId),
        date: String(raw.start_date_local || row.workout_date || "").slice(0, 10),
        name: String(raw.name || row.title || ""),
        sport: String(raw.type || row.sport || ""),
        category: String(raw.category || row.category || ""),
        duration:
          raw.moving_time != null
            ? Number(raw.moving_time)
            : row.planned?.duration_minutes != null
              ? Math.round(Number(row.planned.duration_minutes) * 60)
              : null,
        tss: raw.icu_training_load ?? row.planned?.tss ?? null,
      };
    })
    .filter((row) => row.id && row.date)
    .sort((a, b) => a.id.localeCompare(b.id) || a.date.localeCompare(b.date));
}

function plannedFingerprint(rows, source) {
  return hash(JSON.stringify(normalizedPlanned(rows, source)));
}
function sessionId(req, auth) {
  const value = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (/^[\w-]{43}$/.test(value || "")) return hash(value);
  if (auth.bypass) return "local-bypass";
  throw fail("Sign in or use Refresh to restart automatic imports.");
}
async function body(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json")
    throw fail("Expected JSON.", 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY) throw fail("Probe is too large.", 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw fail("Invalid probe.", 400);
  }
}

// Deliberately NOT a replacement app session. This capability authorizes only a
// boolean change hint from the configured GitHub mirror. It never returns
// workout data, calls a model, reads/writes Supabase, or accepts a provider URL.
// Actual imports/mutations still pass through the unchanged revocable app auth.
// Binding to the HttpOnly session cookie + current password epoch prevents use
// in another browser/session or after local logout/password rotation. Individual
// server-side session revocation is checked by the full import, not by this
// hint endpoint; the hint lease cannot outlive its original authenticated session.
export function createWorkoutChangeProbe({
  readBootstrap,
  getConfig,
  getAuthConfig,
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
} = {}) {
  const requests = new Map();
  async function keys(req) {
    const auth = getAuthConfig(req),
      config = getConfig(),
      bootstrap = await readBootstrap();
    if (!auth.configured && !auth.bypass) throw fail("App authentication is not configured.", 503);
    if (req.headers.origin !== auth.origin || req.headers["sec-fetch-site"] === "cross-site")
      throw fail("This request must come from your application.", 403);
    if (!config.githubToken || !/^[\w.-]+\/[\w.-]+$/.test(config.repo || ""))
      throw fail(
        "Automatic imports need the configured training-data GitHub connection. Manual Refresh is still available.",
        503
      );
    const material = bootstrap.SETTINGS_ENCRYPTION_KEY || bootstrap.SUPABASE_SECRET_KEY || "";
    if (material.length < 32) throw fail("The backend probe signing key is unavailable.", 503);
    const secret = createHash("sha256").update(`${PURPOSE}:${material}`).digest();
    return { auth, config, secret, subject: sessionId(req, auth) };
  }
  function seal(claims, secret) {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
  }
  function open(token, k) {
    if (typeof token !== "string" || token.length > MAX_BODY - 100) throw fail("Invalid probe.");
    const [payload, signature, ...extra] = token.split(".");
    const expected = createHmac("sha256", k.secret)
      .update(payload || "")
      .digest();
    const actual = Buffer.from(signature || "", "base64url");
    if (extra.length || actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw fail("Invalid probe.");
    let c;
    try {
      c = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      throw fail("Invalid probe.");
    }
    if (
      c.purpose !== PURPOSE ||
      c.subject !== k.subject ||
      c.epoch !== k.auth.epoch ||
      c.origin !== k.auth.origin ||
      c.repo !== k.config.repo ||
      c.branch !== (k.config.branch || "main") ||
      !Number.isFinite(c.expires) ||
      !Number.isFinite(c.issued) ||
      c.issued > now() + 60000 ||
      c.expires <= now() ||
      c.expires - c.issued > MAX_SESSION ||
      !Array.isArray(c.known) ||
      c.known.length > 5000 ||
      c.known.some((id) => typeof id !== "string" || !/^[\w-]{1,100}$/.test(id)) ||
      typeof c.planned !== "string" ||
      !/^[\w-]{43}$/.test(c.planned)
    )
      throw fail("The automatic-import check expired. Use Refresh to resume.");
    return c;
  }
  async function latest(config) {
    const key = hash(`${config.repo}@${config.branch}:${config.githubToken}`);
    const previous = requests.get(key);
    if (previous && now() - previous.time < 8000) return previous.promise;
    const promise = (async () => {
      const response = await fetchImpl(
        `https://api.github.com/repos/${config.repo}/contents/latest.json?ref=${encodeURIComponent(config.branch || "main")}`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: `Bearer ${config.githubToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );
      if (!response.ok)
        throw fail(
          `The GitHub workout mirror could not be checked (${response.status}). No database sync was started.`,
          503
        );
      const file = await response.json();
      if (
        file.encoding !== "base64" ||
        typeof file.content !== "string" ||
        file.content.length > 8000000
      )
        throw fail("The GitHub workout mirror is unavailable.", 503);
      let value;
      try {
        value = JSON.parse(Buffer.from(file.content, "base64").toString());
      } catch {
        throw fail("The GitHub workout mirror is invalid.", 503);
      }
      const updated = Date.parse(value.metadata?.last_updated || "");
      if (
        !Number.isFinite(updated) ||
        now() - updated > 86400000 ||
        updated > now() + 300000 ||
        !Array.isArray(value.recent_activities) ||
        value.recent_activities.some((a) => !a || !/^[\w-]{1,100}$/.test(String(a.id || ""))) ||
        !Array.isArray(value.planned_workouts)
      )
        throw fail(
          "The GitHub workout mirror is stale or incomplete. Use Refresh to check the source.",
          503
        );
      return {
        ids: value.recent_activities.map((a) => String(a.id)),
        planned: plannedFingerprint(value.planned_workouts, "mirror"),
      };
    })();
    requests.set(key, { time: now(), promise });
    if (requests.size > 8) requests.delete(requests.keys().next().value);
    try {
      return await promise;
    } catch (error) {
      requests.delete(key);
      throw error;
    }
  }
  return {
    async issue(req, context) {
      const k = await keys(req),
        session = req.appSession;
      if (
        !session ||
        (!session.localBypass &&
          (session.id !== k.subject || session.epoch !== k.auth.epoch || session.expires <= now()))
      )
        throw fail("A current authenticated session is required.");
      const expires = Math.min(session.expires || now() + 86400000, now() + MAX_SESSION);
      const known = completedIds(context);
      if (known.length > 5000) throw fail("Use manual Refresh for this large archive.", 503);
      const planned = plannedFingerprint(context?.planned || [], "app");
      return {
        token: seal(
          {
            purpose: PURPOSE,
            subject: k.subject,
            epoch: k.auth.epoch,
            origin: k.auth.origin,
            repo: k.config.repo,
            branch: k.config.branch || "main",
            issued: now(),
            expires,
            known,
            planned,
          },
          k.secret
        ),
        expiresAt: expires,
        baseline: hash(JSON.stringify({ known, planned })),
      };
    },
    async handle(req, res, pathname) {
      if (pathname !== "/api/workout-changes") return false;
      const json = (status, value) => {
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(JSON.stringify(value));
      };
      try {
        if (req.method !== "POST") throw fail("Method not allowed.", 405);
        const k = await keys(req),
          claims = open((await body(req)).token, k);
        const known = new Set(claims.known),
          mirror = await latest(k.config);
        json(200, {
          changed: mirror.planned !== claims.planned || mirror.ids.some((id) => !known.has(id)),
        });
      } catch (error) {
        json(error.status || 503, {
          error: error.status
            ? error.message
            : "The workout-change check is temporarily unavailable.",
          paused: error.status === 401,
        });
      }
      return true;
    },
  };
}
