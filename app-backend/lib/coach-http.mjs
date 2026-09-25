import { CoachError, createGithubCoachSource } from "./github-coach-source.mjs";
import { coachConfig, createCoach, validateMessages } from "./github-coach.mjs";

export async function bodyJson(req, maxBytes = 160000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > maxBytes) throw new CoachError("This request is too large.", 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CoachError("The request must contain valid JSON.", 400);
  }
}

export function checkOrigin(req, config) {
  let origin;
  try {
    origin = new URL(req.headers.origin);
  } catch {
    throw new CoachError("Reload the app and try again.", 403);
  }
  if (
    origin.host !== req.headers.host ||
    (config.secure && origin.protocol !== "https:") ||
    !["https:", "http:"].includes(origin.protocol) ||
    req.headers["x-coach-request"] !== "1" ||
    req.headers["content-type"]?.split(";")[0] !== "application/json"
  ) {
    throw new CoachError("The chat request must come from this application.", 403);
  }
}

export function createCoachHttp({
  env = () => process.env,
  answer,
  getCalendar,
  timeoutMs = 240000,
} = {}) {
  const run = answer || createCoach({ source: createGithubCoachSource() });
  let running = 0;

  return async function handleCoach(req, res, pathname) {
    const calendarRoute = pathname.match(
      /^\/api\/coach\/calendar(?:\/([a-f0-9-]{36})(\/(?:confirm|decline))?)?$/
    );
    if (!["/api/coach/session", "/api/coach/message"].includes(pathname) && !calendarRoute)
      return false;
    const config = coachConfig(env());
    let streaming = false;
    const json = (status, value, extra = {}) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...extra,
      });
      res.end(JSON.stringify(value));
    };
    const event = (type, value) => {
      if (!res.destroyed && !res.writableEnded)
        res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
    };
    try {
      if (!req.appSession) throw new CoachError("Sign in to your app to continue.", 401);
      const calendar =
        getCalendar && config.githubToken && config.repo ? await getCalendar(req, config) : null;
      if (pathname === "/api/coach/session" && req.method === "GET") {
        const calendarSetup = calendar
          ? await calendar.checkSetup().catch((error) => ({
              available: false,
              error: error instanceof CoachError ? error.message : "Calendar push is unavailable.",
            }))
          : { available: false };
        json(200, {
          configured: !config.missing.length,
          authenticated: true,
          missing: config.missing,
          calendar: calendarSetup,
        });
        return true;
      }
      if (calendarRoute) {
        if (!calendar) throw new CoachError("Calendar push is not configured.", 503);
        const [, id, action] = calendarRoute;
        if (req.method === "GET" && !action) {
          json(200, id ? await calendar.status(id) : { proposals: await calendar.list() });
        } else if (req.method === "POST" && id && action) {
          checkOrigin(req, config);
          const body = await bodyJson(req);
          if (!body || Array.isArray(body) || typeof body !== "object" || Object.keys(body).length)
            throw new CoachError("Use the stored preview without changing its workouts.", 400);
          json(200, await calendar[action === "/confirm" ? "confirm" : "decline"](id));
        } else json(405, { error: "Method not allowed." });
        return true;
      }
      if (req.method !== "POST") {
        json(405, { error: "Method not allowed." });
        return true;
      }
      checkOrigin(req, config);
      if (config.missing.length)
        throw new CoachError(
          "Coach setup is incomplete. Check the server environment variables.",
          503
        );
      const body = await bodyJson(req);
      const messages = validateMessages(body?.messages);
      if (running >= 2)
        throw new CoachError(
          "The coach is already answering. Wait for that response to finish.",
          429
        );
      running++;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      const disconnected = () => {
        if (!res.writableEnded) abort.abort();
      };
      res.on("close", disconnected);
      try {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store, no-transform",
          "X-Content-Type-Options": "nosniff",
          "X-Accel-Buffering": "no",
        });
        streaming = true;
        res.flushHeaders?.();
        const result = await run({
          config,
          messages,
          signal: abort.signal,
          calendar,
          onStatus: (text) => event("status", { text }),
          onToken: (text) => event("token", { text }),
        });
        event("answer", result);
      } finally {
        running--;
        clearTimeout(timer);
        res.off("close", disconnected);
      }
    } catch (error) {
      const message =
        error instanceof CoachError
          ? error.message
          : error?.name === "AbortError" || error?.name === "TimeoutError"
            ? "This response timed out. Try a more focused question."
            : "The coach could not connect to its data or AI service. Please try again.";
      if (streaming) event("error", { error: message });
      else json(error instanceof CoachError ? error.status : 502, { error: message });
    } finally {
      if (streaming && !res.writableEnded) res.end();
    }
    return true;
  };
}
