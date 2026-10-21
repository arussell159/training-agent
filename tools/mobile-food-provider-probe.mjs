// Read-only bounded catalog probe; credentials loaded by node --env-file-if-exists.
import fs from "node:fs/promises";
import { createFoodCatalog } from "../app-backend/lib/nutrition-fatsecret.mjs";
const upstream = [];
const catalog = createFoodCatalog({
  fetchImpl: async (input, options) => {
    const start = performance.now();
    try {
      const response = await fetch(input, options);
      upstream.push({
        path: new URL(input).pathname,
        status: response.status,
        headersMs: Math.round(performance.now() - start),
      });
      return response;
    } catch (error) {
      upstream.push({
        path: new URL(input).pathname,
        error: error.name,
        ms: Math.round(performance.now() - start),
      });
      throw error;
    }
  },
});
const evidence = {
  configured: catalog.configured(),
  mode: process.env.FATSECRET_CONSUMER_KEY ? "OAuth1" : "OAuth2",
  operations: [],
  upstream,
};
if (evidence.configured) {
  const start = performance.now();
  try {
    const products = await catalog.search("oats");
    evidence.operations.push({
      kind: "search",
      ms: Math.round(performance.now() - start),
      count: products.length,
    });
    if (products[0]) {
      const start = performance.now();
      const detail = await catalog.product(products[0].code);
      evidence.operations.push({
        kind: "detail",
        ms: Math.round(performance.now() - start),
        servings: detail.servings.length,
        complete: detail.complete,
      });
    }
  } catch (error) {
    evidence.operations.push({
      kind: "failure",
      ms: Math.round(performance.now() - start),
      status: error.status,
      message: error.message,
    });
  }
}
await fs.mkdir("artifacts/mobile-stability", { recursive: true });
await fs.writeFile(
  "artifacts/mobile-stability/live-provider.json",
  JSON.stringify(evidence, null, 2) + "\n"
);
console.log(JSON.stringify(evidence));
