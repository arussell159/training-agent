import { createHmac, randomBytes } from "node:crypto";
import { NutritionError } from "./nutrition-model.mjs";

const encode = (value) =>
  encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
export function oauth1Signature(method, url, params, secret, tokenSecret = "") {
  const normalized = Object.entries(params)
    .map(([key, value]) => [encode(key), encode(value)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map((pair) => pair.join("="))
    .join("&");
  return createHmac("sha1", `${encode(secret)}&${encode(tokenSecret)}`)
    .update([method.toUpperCase(), url, normalized].map(encode).join("&"))
    .digest("base64");
}

export function createFatSecretOAuth1({ env = () => process.env, fetchImpl = fetch } = {}) {
  const configured = () => Boolean(env().FATSECRET_CONSUMER_KEY && env().FATSECRET_CONSUMER_SECRET);
  async function request(path, params = {}, { method = "GET", profile } = {}) {
    if (!configured())
      throw new NutritionError(
        "Add the FatSecret OAuth 1.0 Consumer Key and Shared Secret to .env.local and restart the preview.",
        503
      );
    const url = `https://platform.fatsecret.com/rest/${path}`;
    const values = {
      ...params,
      format: "json",
      oauth_consumer_key: env().FATSECRET_CONSUMER_KEY,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
      oauth_nonce: randomBytes(16).toString("hex"),
      oauth_version: "1.0",
      ...(profile ? { oauth_token: profile.auth_token } : {}),
    };
    values.oauth_signature = oauth1Signature(
      method,
      url,
      values,
      env().FATSECRET_CONSUMER_SECRET,
      profile?.auth_secret
    );
    const body = new URLSearchParams(values).toString();
    let response;
    try {
      response = await fetchImpl(method === "GET" ? `${url}?${body}` : url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        ...(method === "GET"
          ? {}
          : { body, headers: { "Content-Type": "application/x-www-form-urlencoded" } }),
      });
    } catch {
      throw new NutritionError(
        method === "GET"
          ? "FatSecret did not respond. Please retry."
          : "FatSecret did not confirm the save. Reload your diary before retrying.",
        502
      );
    }
    if (!response.ok)
      throw new NutritionError("FatSecret could not complete this request. Please retry.", 502);
    const data = await response.json();
    if (data.error) {
      const error = new NutritionError(
        `FatSecret rejected the request (code ${Number(data.error.code) || 0}). Check your OAuth 1.0 API access.`,
        502
      );
      error.providerCode = Number(data.error.code);
      throw error;
    }
    return data;
  }
  return { configured, request };
}
