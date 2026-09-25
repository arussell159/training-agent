import { bodyJson, checkOrigin } from "./coach-http.mjs";
import { CoachError } from "./github-coach-source.mjs";
import { coachConfig } from "./github-coach.mjs";
import { validateReportRequest } from "./report-targets.mjs";

export function createReportsHttp({ getReports, getCatalog, getStore, env = () => process.env }) {
  return async function handleReports(req, res, pathname) {
    if (pathname !== "/api/coach/reports" && !pathname.startsWith("/api/coach/reports/"))
      return false;
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
      const config = coachConfig(env());
      if (req.method === "POST") checkOrigin(req, config);
      if (pathname === "/api/coach/reports") {
        const store = await getStore();
        if (req.method === "GET") json(200, await getCatalog());
        else if (req.method === "POST")
          json(200, await store.upsert(await bodyJson(req, 1_000_000)));
        else json(405, { error: "Method not allowed." });
        return true;
      }
      const item = pathname.match(/^\/api\/coach\/reports\/([a-f0-9]{40})$/);
      if (item) {
        if (req.method !== "GET") json(405, { error: "Method not allowed." });
        else {
          const report = await (await getStore()).get(item[1]);
          json(report ? 200 : 404, report || { error: "Report not found." });
        }
        return true;
      }
      if (pathname === "/api/coach/reports/catalog") {
        if (req.method === "POST") await bodyJson(req);
        else if (req.method !== "GET") {
          json(405, { error: "Method not allowed." });
          return true;
        }
        json(200, await getCatalog());
        return true;
      }
      if (req.method !== "POST") {
        json(405, { error: "Method not allowed." });
        return true;
      }
      const body = await bodyJson(req);
      const target = validateReportRequest(body);
      if (pathname === "/api/coach/reports/status" && getCatalog) {
        const catalog = await getCatalog();
        const report = catalog.reports.find(
          (report) =>
            report.kind === target.kind &&
            report.startDate === target.startDate &&
            (target.kind !== "block" || !report.planId || report.planId === target.planId)
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
                  reason: "The completed report will appear here after it is saved in the app.",
                }
          );
          return true;
        }
      }
      if (!config.githubToken || !config.repo)
        throw new CoachError("Section 11's GitHub connection is not configured.", 503);
      const reports = await getReports(config);
      if (pathname === "/api/coach/reports/status") json(200, await reports.status(target));
      else if (pathname === "/api/coach/reports/generate")
        json(200, await reports.generate(target));
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
