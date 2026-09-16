import fs from "node:fs/promises";

const metadataUrl = new URL("../section-11-upstream.json", import.meta.url);
let cachedRemote = null;
let checkedAt = 0;

export async function section11UpstreamStatus(fetchImpl = fetch) {
  const installed = JSON.parse(await fs.readFile(metadataUrl, "utf8"));
  if (!cachedRemote || Date.now() - checkedAt > 6 * 60 * 60 * 1000) {
    checkedAt = Date.now();
    try {
      const response = await fetchImpl(
        "https://api.github.com/repos/CrankAddict/section-11/commits/main",
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "training-agent-section-11-updater",
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      cachedRemote = response.ok ? String((await response.json()).sha || "") || null : null;
    } catch {
      cachedRemote = null;
    }
  }
  return {
    repository: installed.repository,
    branch: installed.branch,
    installed_commit: installed.commit,
    installed_at: installed.synced_at,
    latest_commit: cachedRemote,
    update_available: Boolean(cachedRemote && cachedRemote !== installed.commit),
    checked_at: new Date(checkedAt).toISOString(),
  };
}
