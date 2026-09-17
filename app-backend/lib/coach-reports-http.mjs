import { bodyJson, checkOrigin } from "./coach-http.mjs";
import { CoachError } from "./github-coach-source.mjs";
import { coachConfig } from "./github-coach.mjs";
import { validateReportRequest } from "./report-targets.mjs";

export function createReportsHttp({ getReports, env = () => process.env }) {
  return async function handleReports(req, res, pathname) {
    if (!pathname.startsWith("/api/coach/reports/")) return false;
    const json = (status, value) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (!req.appSession) throw new CoachError("Sign in to your app to continue.", 401);
      if (req.method !== "POST") {
        json(405, { error: "Method not allowed." });
        return true;
      }
      const config = coachConfig(env());
      checkOrigin(req, config);
      if (!config.githubToken || !config.repo)
        throw new CoachError("Section 11's GitHub connection is not configured.", 503);
      const body = await bodyJson(req);
      const reports = await getReports(config);
      if (pathname === "/api/coach/reports/catalog") {
        json(200, await reports.catalog());
        return true;
      }
      const target = validateReportRequest(body);
      if (pathname === "/api/coach/reports/status") json(200, await reports.status(target));
      else if (pathname === "/api/coach/reports/generate")
        json(200, await reports.generate(target));
      else if (pathname === "/api/coach/reports/sync" && target.kind === "post")
        json(200, await reports.status(target, true));
      else json(404, { error: "Report endpoint not found." });
    } catch (error) {
      json(error instanceof CoachError ? error.status : 502, {
        error:
          error instanceof CoachError
            ? error.message
            : "Section 11 could not finish this request. Your saved reports are unchanged; check again before retrying.",
      });
    }
    return true;
  };
}
