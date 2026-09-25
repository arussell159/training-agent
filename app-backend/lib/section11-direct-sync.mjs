import { createHmac } from "node:crypto";

export async function runSection11DirectSync({
  repo,
  branch,
  githubToken,
  intervalsKey,
  athleteId,
  weekStart = "",
  zonePreference = "",
  origin,
  fetchImpl = fetch,
  now = Date.now,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "") || !/^[\w./-]+$/.test(branch || ""))
    throw Error("Configure the Section 11 training repository before refreshing.");
  if (!githubToken || !intervalsKey || !athleteId)
    throw Error("Section 11 direct sync needs the GitHub token and Intervals.icu connection.");
  if (!origin) throw Error("Section 11 direct sync needs the application's server URL.");

  const body = JSON.stringify({
    repo,
    branch,
    athlete_id: String(athleteId),
    intervals_key: intervalsKey,
    days: 7,
    week_start: weekStart,
    zone_preference: zonePreference,
  });
  const timestamp = String(Math.floor(now() / 1000));
  const signature = createHmac("sha256", githubToken).update(`${timestamp}.${body}`).digest("hex");
  const response = await fetchImpl(new URL("/internal/section11-worker", origin), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(255_000),
    headers: {
      "Content-Type": "application/json",
      "X-Section11-Timestamp": timestamp,
      "X-Section11-Signature": signature,
    },
    body,
  });
  let result;
  try {
    result = await response.json();
  } catch {
    result = {};
  }
  if (!response.ok || result.status !== "complete")
    throw Error(result.error || `Section 11 direct sync failed (HTTP ${response.status}).`);
  return result;
}
