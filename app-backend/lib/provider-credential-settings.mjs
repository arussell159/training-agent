import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  privateBindingHash as hash,
  privateBindingKey,
  privateBindingError as fail,
  providerCredentialFingerprint,
} from "./private-provider-binding-model.mjs";

// Standalone compare-and-set adapter for the EXISTING encrypted settings row.
// It preserves createSupabaseSettingsStore's encryption domain/format and uses
// both exact ciphertext and timestamp as filters, avoiding millisecond races.
// No schema change, upsert, bootstrap fallback or credential logging occurs.
export function createProviderCredentialSettings(config, fetchImpl = fetch) {
  const url = String(config.SUPABASE_URL || "").replace(/\/$/, ""),
    secret = config.SUPABASE_SECRET_KEY,
    material = config.SETTINGS_ENCRYPTION_KEY || secret,
    scope = config.SETTINGS_SCOPE || "default",
    name = "INTERVALS_API_KEY";
  if (
    !/^https:\/\/[^/]+$/.test(url) ||
    !secret ||
    typeof material !== "string" ||
    material.length < 32
  )
    fail("Credential storage is unavailable.", 503, "PRIVATE_BINDING_ENVIRONMENT");
  const encryptionKey = createHash("sha256")
    .update(`ar-performance-settings:v1:${material}`)
    .digest();
  const encode = (key) => {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    cipher.setAAD(Buffer.from(`${scope}:${name}`));
    const value = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
    return [
      "v1",
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      value.toString("base64"),
    ].join(".");
  };
  function decode(row) {
    try {
      if (
        !row ||
        row.scope !== scope ||
        row.name !== name ||
        typeof row.encrypted_value !== "string" ||
        row.encrypted_value.length > 4096 ||
        typeof row.updated_at !== "string" ||
        row.updated_at.length > 80 ||
        !Number.isFinite(Date.parse(row.updated_at))
      )
        throw Error();
      const [version, iv, tag, value, ...extra] = row.encrypted_value.split(".");
      if (version !== "v1" || extra.length) throw Error();
      const cipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64"));
      cipher.setAAD(Buffer.from(`${scope}:${name}`));
      cipher.setAuthTag(Buffer.from(tag, "base64"));
      const key = Buffer.concat([
        cipher.update(Buffer.from(value, "base64")),
        cipher.final(),
      ]).toString("utf8");
      if (!privateBindingKey(key)) throw Error();
      return {
        key,
        fingerprint: providerCredentialFingerprint(config, key),
        revision: hash({ scope, name, encrypted: row.encrypted_value, updated: row.updated_at }),
      };
    } catch {
      fail(
        "The configured credential could not be unlocked.",
        503,
        "PRIVATE_BINDING_SETTINGS_INVALID"
      );
    }
  }
  const query = () => new URLSearchParams({ scope: `eq.${scope}`, name: `eq.${name}` });
  async function request(params, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${url}/rest/v1/app_settings?${params}`, {
        ...options,
        signal: AbortSignal.timeout(15000),
        headers: {
          apikey: secret,
          ...(!secret.startsWith("sb_secret_") ? { Authorization: `Bearer ${secret}` } : {}),
          "Content-Type": "application/json",
          Accept: "application/json",
          "Cache-Control": "no-store",
          Prefer: "return=representation",
          ...options.headers,
        },
      });
    } catch {
      fail(
        "The credential settings operation could not be confirmed. Recheck its original identity."
      );
    }
    if (!response.ok)
      fail(
        "Credential storage rejected the request.",
        response.status >= 400 && response.status < 500 ? response.status : 502,
        response.status >= 400 && response.status < 500
          ? "PRIVATE_BINDING_SETTINGS_REJECTED"
          : "PRIVATE_BINDING_UNCONFIRMED"
      );
    try {
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length > 1) throw Error();
      return rows;
    } catch {
      fail("The credential settings response could not be verified.");
    }
  }
  async function snapshot() {
    const params = query();
    params.set("select", "scope,name,encrypted_value,updated_at");
    const rows = await request(params);
    if (rows.length !== 1)
      fail(
        "A saved provider credential is required before private storage can be bound.",
        409,
        "PRIVATE_BINDING_KEY_UNAVAILABLE"
      );
    return { row: rows[0], value: decode(rows[0]) };
  }
  return {
    read: async () => (await snapshot()).value,
    async compareAndSet({ expectedRevision, candidateKey }) {
      if (!/^[a-f0-9]{64}$/.test(expectedRevision || "") || !privateBindingKey(candidateKey))
        fail("Choose a valid credential refresh.", 400, "PRIVATE_BINDING_INVALID");
      const current = await snapshot();
      if (current.value.revision !== expectedRevision)
        fail(
          "The provider setting changed. Recheck the original refresh.",
          409,
          "PRIVATE_BINDING_SETTINGS_CHANGED"
        );
      const params = query();
      params.set("updated_at", `eq.${current.row.updated_at}`);
      params.set("encrypted_value", `eq.${current.row.encrypted_value}`);
      const next = { encrypted_value: encode(candidateKey), updated_at: new Date().toISOString() },
        saved = await request(params, { method: "PATCH", body: JSON.stringify(next) });
      if (!saved.length)
        fail(
          "The provider setting changed. No replacement was made.",
          409,
          "PRIVATE_BINDING_SETTINGS_CHANGED"
        );
      const decoded = decode(saved[0]);
      if (decoded.key !== candidateKey) fail("The credential replacement could not be verified.");
      return decoded;
    },
  };
}
