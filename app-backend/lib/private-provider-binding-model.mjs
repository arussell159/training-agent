import { createHash } from "node:crypto";
import { contentFingerprint } from "./content-fingerprint.mjs";

export const privateBindingHash = contentFingerprint;
export const privateBindingDigest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const privateBindingUuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export const privateBindingKey = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 1024 &&
  value.trim() === value &&
  !/[\r\n]/.test(value);
export function privateBindingError(message, status = 502, code = "PRIVATE_BINDING_UNCONFIRMED") {
  throw Object.assign(Error(message), { status, code });
}
export function providerCredentialFingerprint(config, key = config.INTERVALS_API_KEY) {
  if (!privateBindingKey(key))
    privateBindingError(
      "The configured provider credential is unavailable.",
      409,
      "PRIVATE_BINDING_KEY_UNAVAILABLE"
    );
  return createHash("sha256")
    .update(`${config.SETTINGS_SCOPE || "default"}:${key}`)
    .digest("hex");
}
export function privateBindingContext(config, actor) {
  if (
    !actor ||
    typeof actor.id !== "string" ||
    !actor.id ||
    actor.id.length > 256 ||
    typeof actor.origin !== "string" ||
    typeof actor.readOnly !== "boolean"
  )
    privateBindingError("Sign in to the private provider account.", 401, "PRIVATE_BINDING_AUTH");
  let origin, database;
  try {
    origin = new URL(actor.origin);
    database = new URL(String(config.SUPABASE_URL || "").replace(/\/$/, ""));
  } catch {
    privateBindingError(
      "The private storage environment is unavailable.",
      503,
      "PRIVATE_BINDING_ENVIRONMENT"
    );
  }
  if (
    origin.origin !== actor.origin ||
    (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) ||
    database.protocol !== "https:" ||
    database.origin !== database.href.replace(/\/$/, "")
  )
    privateBindingError(
      "The private storage environment is unavailable.",
      503,
      "PRIVATE_BINDING_ENVIRONMENT"
    );
  const scope = config.SETTINGS_SCOPE || "default",
    material = config.SETTINGS_ENCRYPTION_KEY || config.SUPABASE_SECRET_KEY;
  if (
    typeof scope !== "string" ||
    !scope ||
    scope.length > 256 ||
    typeof material !== "string" ||
    material.length < 32
  )
    privateBindingError(
      "The private storage environment is unavailable.",
      503,
      "PRIVATE_BINDING_ENVIRONMENT"
    );
  return {
    ownerHash: contentFingerprint({ origin: actor.origin, actor: actor.id, scope }),
    environmentHash: contentFingerprint({
      origin: actor.origin,
      scope,
      database: database.origin,
      encryption: contentFingerprint({ material }),
    }),
    origin: actor.origin,
    scope,
  };
}
