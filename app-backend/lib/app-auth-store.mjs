import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// One small encrypted record per app origin. Compare-and-swap updates make challenge
// consumption, throttling and session revocation atomic across Vercel instances.
// Uses the existing backend-only app_settings table; no browser database access.
export function createAuthStore(bootstrap, origin, fetchImpl = fetch) {
  return createEncryptedRecordStore(
    bootstrap,
    origin,
    {
      namespace: "auth",
      name: "APP_AUTH",
      fresh: () => ({
        userID: randomBytes(32).toString("base64url"),
        credentials: [],
        sessions: [],
        challenges: [],
        limits: {},
      }),
    },
    fetchImpl
  );
}

// Separate namespaces keep calendar proposals out of authentication records.
export function createEncryptedRecordStore(
  bootstrap,
  identity,
  { namespace, name, fresh, timestampCas = false },
  fetchImpl = fetch
) {
  const url = String(bootstrap.SUPABASE_URL || "").replace(/\/$/, "");
  const secret = bootstrap.SUPABASE_SECRET_KEY;
  if (!url.startsWith("https://") || !secret)
    throw new Error(
      "Authentication storage is unavailable. Check the backend Supabase connection."
    );
  const key = createHash("sha256")
    .update(`app-auth:v1:${bootstrap.SETTINGS_ENCRYPTION_KEY || secret}`)
    .digest();
  const scope = `${bootstrap.SETTINGS_SCOPE || "default"}:${namespace}:${createHash("sha256").update(identity).digest("hex")}`;
  const filter = `?scope=eq.${encodeURIComponent(scope)}&name=eq.${encodeURIComponent(name)}`;
  const versionColumn = timestampCas ? "updated_at" : "encrypted_value";
  function nextTimestamp(previous) {
    if (!timestampCas || !previous) return new Date().toISOString();
    // PostgreSQL retains microseconds. Always advance the previous revision, even
    // on the same millisecond or when another server's clock is ahead. Using the
    // short revision avoids placing a large encrypted workout plan in a URL.
    const fraction = (previous.match(/\.(\d+)/)?.[1] || "").padEnd(6, "0").slice(0, 6);
    const prior = BigInt(Date.parse(previous)) * 1000n + BigInt(fraction.slice(3));
    const clock = BigInt(Date.now()) * 1000n;
    const next = clock > prior ? clock : prior + 1n;
    return new Date(Number(next / 1000n))
      .toISOString()
      .replace(/\.\d{3}Z$/, `.${String(next % 1000000n).padStart(6, "0")}Z`);
  }
  function encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(scope));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      data.toString("base64url"),
    ].join(".");
  }
  function decrypt(value) {
    try {
      const [version, iv, tag, data, extra] = value.split(".");
      if (version !== "v1" || extra) throw new Error();
      const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      cipher.setAAD(Buffer.from(scope));
      cipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(
        Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]).toString()
      );
    } catch {
      throw new Error(
        "Authentication storage could not be unlocked. Check the backend encryption key."
      );
    }
  }
  async function request(query, options = {}) {
    const response = await fetchImpl(`${url}/rest/v1/app_settings${query}`, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: {
        apikey: secret,
        ...(!secret.startsWith("sb_secret_") ? { Authorization: `Bearer ${secret}` } : {}),
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        Prefer: "return=representation",
        ...options.headers,
      },
    });
    if (!response.ok) throw new Error("Authentication storage is unavailable. Please try again.");
    return response.json();
  }
  async function read() {
    const rows = await request(`${filter}&select=encrypted_value,updated_at`);
    return {
      version: rows[0]?.[versionColumn],
      state: rows[0] ? decrypt(rows[0].encrypted_value) : fresh(),
    };
  }
  return {
    async read() {
      return (await read()).state;
    },
    async update(change) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const { state, version } = await read();
        // change must be synchronous and safe to retry; it must not perform external work.
        const result = change(state);
        const row = {
          scope,
          name,
          encrypted_value: encrypt(state),
          updated_at: nextTimestamp(version),
        };
        const rows = version
          ? await request(`${filter}&${versionColumn}=eq.${encodeURIComponent(version)}`, {
              method: "PATCH",
              body: JSON.stringify(row),
            })
          : await request("?on_conflict=scope,name", {
              method: "POST",
              body: JSON.stringify([row]),
              headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
            });
        if (rows.length === 1) return result;
      }
      throw new Error("Sign-in is busy. Please try again.");
    },
  };
}
