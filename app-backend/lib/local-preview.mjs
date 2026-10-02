export const databaseOffline = (env = process.env) =>
  env.LOCAL_DATABASE_OFFLINE === "true" && !env.VERCEL;

export function previewConfig(config, env = process.env) {
  if (!databaseOffline(env)) return config;
  // Local previews use existing files and never initialize a remote database client.
  return { ...config, SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" };
}

export function createPreviewFetch(fetchImpl, databaseUrls = []) {
  const blockedHosts = new Set(
    databaseUrls.filter(Boolean).map((value) => new URL(value).hostname)
  );
  return async (input, options) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (blockedHosts.has(url.hostname) || /(^|\.)supabase\.(co|in|com)$/.test(url.hostname))
      throw new Error("Supabase is disabled in the local preview; use locally cached data.");
    return fetchImpl(input, options);
  };
}
