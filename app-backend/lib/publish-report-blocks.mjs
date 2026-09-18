import { planReportBlocks } from "./report-blocks.mjs";
import { coachConfig } from "./github-coach.mjs";

export function reportBlockManifest(plans, activeId, timeZone = "America/Chicago") {
  const plan = plans.find((p) => p.id === activeId);
  return {
    schema_version: 1,
    source: "training-agent-active-plan",
    time_zone: timeZone,
    plan_id: plan?.id || null,
    blocks: planReportBlocks(plan).map((b) => ({
      start_date: b.startDate,
      end_date: b.endDate,
      phase: b.phase,
      weeks: b.weeks.map((w) => ({
        start_date: w.startDate,
        end_date: w.endDate,
        phase: w.phase,
        focus: w.focus || "",
        limiters: w.limiters || "",
        restrictions: w.restrictions || "",
      })),
    })),
  };
}

export async function publishReportBlocks(
  plans,
  activeId,
  config = coachConfig(),
  fetchImpl = fetch
) {
  if (!config.repo || !config.githubToken)
    throw new Error("GitHub is required to synchronize block-report dates.");
  const manifest = reportBlockManifest(plans, activeId, config.calendarTimeZone);
  const endpoint = `https://api.github.com/repos/${config.repo}/contents/app-report-blocks.json`;
  const headers = {
    Authorization: `Bearer ${config.githubToken}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await fetchImpl(`${endpoint}?ref=${encodeURIComponent(config.branch)}`, {
      headers,
      signal: AbortSignal.timeout(30000),
    });
    if (!before.ok && before.status !== 404)
      throw new Error("Could not read the GitHub block schedule.");
    const existing = before.ok ? await before.json() : null;
    const previous = existing
      ? JSON.parse(Buffer.from(existing.content, "base64").toString())
      : null;
    manifest.enabled_from =
      previous?.enabled_from ||
      new Intl.DateTimeFormat("en-CA", {
        timeZone: manifest.time_zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    const content = JSON.stringify(manifest, null, 2) + "\n";
    if (existing && Buffer.from(existing.content, "base64").toString() === content) return manifest;
    const saved = await fetchImpl(endpoint, {
      method: "PUT",
      headers,
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        message: "Sync app-defined report blocks",
        branch: config.branch,
        sha: existing?.sha,
        content: Buffer.from(content).toString("base64"),
      }),
    });
    if (saved.ok) return manifest;
    if (saved.status !== 409) break;
  }
  throw new Error(
    "Plan saved, but GitHub block schedule sync failed. Save the plan again to retry."
  );
}
