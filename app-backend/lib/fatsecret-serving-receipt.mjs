import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NutritionError } from "./nutrition-model.mjs";

// The browser retains provider facts for less than the provider's 24h limit.
// Signing those facts lets a save verify an already-selected serving without
// making a second catalog lookup. Neither facts nor receipts are stored server-side.
export function createServingReceipts({ env = () => process.env, now = Date.now } = {}) {
  const signingKey = () => {
    const config = env();
    const oauth1 = Boolean(config.FATSECRET_CONSUMER_KEY && config.FATSECRET_CONSUMER_SECRET);
    const secret = oauth1 ? config.FATSECRET_CONSUMER_SECRET : config.FATSECRET_CLIENT_SECRET;
    if (!secret) return null;
    return createHash("sha256")
      .update(
        JSON.stringify([
          "fatsecret-serving-v1",
          oauth1 ? config.FATSECRET_CONSUMER_KEY : config.FATSECRET_CLIENT_ID,
          secret,
          config.SETTINGS_SCOPE || "default",
          config.SETTINGS_ENCRYPTION_KEY ||
            config.APP_PASSWORD ||
            config.COACH_ACCESS_PASSWORD ||
            "",
        ])
      )
      .digest();
  };
  const signature = (payload, key) => createHmac("sha256", key).update(payload).digest();
  return {
    attach(product) {
      const key = signingKey();
      if (!key || !product?.servings?.length) return product;
      const issuedAt = now();
      return {
        ...product,
        catalogExpiresAt: issuedAt + 23 * 60 * 60_000,
        servings: product.servings.map(({ catalogReceipt: _old, ...serving }) => {
          const payload = Buffer.from(
            JSON.stringify({
              version: 1,
              issuedAt,
              expiresAt: issuedAt + 23 * 60 * 60_000,
              food: {
                code: product.code,
                name: product.name,
                brand: product.brand,
                imageUrl: product.imageUrl,
              },
              serving,
            })
          ).toString("base64url");
          return {
            ...serving,
            catalogReceipt: `${payload}.${signature(payload, key).toString("base64url")}`,
          };
        }),
      };
    },
    resolve(entry) {
      if (!entry.catalogReceipt) return null;
      const key = signingKey();
      if (!key) return null;
      const value = entry.catalogReceipt;
      const invalid = () =>
        new NutritionError(
          "This saved food serving could not be verified. Reopen its details before adding it."
        );
      if (typeof value !== "string" || value.length > 8192) throw invalid();
      const [payload, encoded, extra] = value.split(".");
      if (!payload || !encoded || extra) throw invalid();
      const received = Buffer.from(encoded, "base64url");
      const expected = signature(payload, key);
      if (received.length !== expected.length || !timingSafeEqual(received, expected))
        throw invalid();
      let data;
      try {
        data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        throw invalid();
      }
      if (
        data.version !== 1 ||
        !Number.isFinite(data.issuedAt) ||
        !Number.isFinite(data.expiresAt) ||
        data.expiresAt - data.issuedAt > 23 * 60 * 60_000 ||
        data.issuedAt > now() + 60_000 ||
        data.food?.code !== entry.foodId ||
        data.serving?.id !== entry.servingId
      )
        throw invalid();
      // Expired facts are re-requested through the normal bounded provider path.
      if (data.expiresAt <= now()) return null;
      return {
        ...data.food,
        catalogExpiresAt: data.expiresAt,
        servings: [{ ...data.serving, catalogReceipt: value }],
      };
    },
  };
}
