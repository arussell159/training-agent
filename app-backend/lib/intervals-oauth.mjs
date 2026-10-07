import { createHash, randomBytes } from "node:crypto";
import { secretMatches } from "./intervals-webhook.mjs";

export const OAUTH_SCOPES = "ACTIVITY:READ,WELLNESS:READ,CALENDAR:READ,SETTINGS:READ";
const COOKIE = "intervals_oauth_state";
const digest = (value) => createHash("sha256").update(value).digest("hex");
export const freshIntervalsOAuth = () => ({ pending: [] });
export function intervalsOrigin(env, req) {
  const value =
    env.APP_ORIGIN ||
    (env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : !env.VERCEL
        ? `http://${req.headers.host}`
        : "");
  const url = new URL(value);
  if (
    url.origin !== value ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
  )
    throw Error("Set APP_ORIGIN to the app's HTTPS origin.");
  return url.origin;
}
export function createIntervalsOAuth({
  config,
  origin,
  store,
  athlete,
  fetchImpl = fetch,
  now = Date.now,
}) {
  const redirectUri = `${origin}/api/intervals/oauth/callback`;
  const cookie = (value, seconds) =>
    `${COOKIE}=${value}; Path=/api/intervals/oauth; HttpOnly; SameSite=Lax; Max-Age=${seconds}${origin.startsWith("https:") ? "; Secure" : ""}`;
  return {
    async start() {
      if (!config.INTERVALS_CLIENT_ID || !config.INTERVALS_CLIENT_SECRET)
        throw Error("The server's Intervals.icu OAuth connection is not configured.");
      const expected = await athlete();
      if (!expected?.id) throw Error("Connect your personal Intervals.icu API key first.");
      const state = randomBytes(32).toString("base64url");
      await store.update((record) => {
        record.pending = (record.pending || []).filter((entry) => entry.expires > now()).slice(-4);
        record.pending.push({
          hash: digest(state),
          expires: now() + 600_000,
          athleteId: String(expected.id),
        });
      });
      const url = new URL("https://intervals.icu/oauth/authorize");
      url.search = new URLSearchParams({
        client_id: config.INTERVALS_CLIENT_ID,
        redirect_uri: redirectUri,
        scope: OAUTH_SCOPES,
        state,
      }).toString();
      return { url: url.href, cookie: cookie(state, 600) };
    },
    async callback(query, cookieHeader = "") {
      const state = query.get("state") || "";
      const binding = cookieHeader
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1);
      if (!/^[\w-]{43}$/.test(state) || !secretMatches(state, binding))
        throw Error("Connection expired. Start again from Settings → Intervals.icu.");
      const pending = await store.update((record) => {
        const entry = (record.pending || []).find(
          (item) => item.hash === digest(state) && item.expires > now()
        );
        record.pending = (record.pending || []).filter(
          (item) => item.hash !== digest(state) && item.expires > now()
        );
        return entry || null;
      });
      if (!pending) throw Error("Connection expired or already used. Start again from Settings.");
      if (query.has("error"))
        throw Error("Intervals.icu connection was declined. You can try again in Settings.");
      const code = query.get("code");
      if (!code || code.length > 512) throw Error("Missing authorization code.");
      const response = await fetchImpl("https://intervals.icu/api/oauth/token", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: config.INTERVALS_CLIENT_ID,
          client_secret: config.INTERVALS_CLIENT_SECRET,
          code,
        }),
      });
      if (!response.ok)
        throw Error("Intervals.icu authorization failed. Check the client secret and try again.");
      const token = await response.json();
      if (!token.access_token || String(token.athlete?.id) !== pending.athleteId)
        throw Error("Authorize the same athlete as your saved personal API key.");
      const granted = String(token.scope || "")
        .split(",")
        .map((scope) => scope.trim());
      const scopesComplete = OAUTH_SCOPES.split(",").every(
        (scope) => granted.includes(scope) || granted.includes(scope.replace(":READ", ":WRITE"))
      );
      await store.update((record) => {
        record.connection = {
          athleteId: pending.athleteId,
          token: token.access_token,
          scope: String(token.scope || ""),
          scopesComplete,
          connectedAt: new Date(now()).toISOString(),
        };
      });
      return { cookie: cookie("", 0), scopesComplete };
    },
    async status() {
      const record = await store.read();
      const connection = record.connection;
      return {
        oauthConnected: Boolean(connection?.token),
        scopesComplete: Boolean(connection?.scopesComplete),
        athleteId: connection?.athleteId || null,
        connectedAt: connection?.connectedAt || null,
        redirectUri,
      };
    },
  };
}
