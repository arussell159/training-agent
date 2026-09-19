import { bodyJson, checkOrigin } from "./coach-http.mjs";
import { CoachError } from "./github-coach-source.mjs";
import { coachConfig } from "./github-coach.mjs";
import { validateReportRequest } from "./report-targets.mjs";

export function createReportsHttp({ getReports, getCatalog, env = () => process.env }) {
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
      if (pathname === "/api/coach/reports/catalog") {
        await bodyJson(req);
        json(200, await getCatalog());
        return true;
      }
      const body = await bodyJson(req);
      const target = validateReportRequest(body);
      if (pathname === "/api/coach/reports/status" && getCatalog) {
        const catalog = await getCatalog();
        const report = catalog.reports.find(
          (report) =>
            report.kind === target.kind &&
            (["pre", "post"].includes(target.kind)
              ? report.workoutId === target.workoutId
              : report.startDate === target.startDate)
        );
        if (report || ["weekly", "block"].includes(target.kind)) {
          json(
            200,
            report
              ? {
                  status: "complete",
                  eligible: false,
                  text: report.text,
                  target: {
                    title: report.title,
                    startDate: report.startDate,
                    endDate: report.endDate,
                  },
                }
              : {
                  status: "empty",
                  eligible: false,
                  reason:
                    "The completed report will appear here after it is saved in Intervals.icu.",
                }
          );
          return true;
        }
      }
      if (!config.githubToken || !config.repo)
        throw new CoachError("Section 11's GitHub connection is not configured.", 503);
      const reports = await getReports(config);
      if (pathname === "/api/coach/reports/status") json(200, await reports.status(target));
      else if (
        pathname === "/api/coach/reports/generate" &&
        ["weekly", "block"].includes(target.kind)
      )
        throw new CoachError(
          "Weekly and block reports are read from Intervals.icu and cannot be generated here.",
          409
        );
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
