import { bodyJson, checkOrigin } from "./coach-http.mjs";
import { coachConfig } from "./github-coach.mjs";
import { NutritionError, nutritionDate } from "./nutrition-model.mjs";
import { createFoodCatalog, estimateFood } from "./nutrition-providers.mjs";

export function createNutritionHttp({
  getStore,
  env = () => process.env,
  catalog = createFoodCatalog(),
  estimate = estimateFood,
}) {
  let running = 0;
  return async (req, res, pathname) => {
    if (pathname !== "/api/nutrition" && !pathname.startsWith("/api/nutrition/")) return false;
    const json = (status, data) => {
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(JSON.stringify(data));
      }
    };
    try {
      if (!req.appSession) throw new NutritionError("Sign in to view your food log.", 401);
      const config = coachConfig(env());
      if (req.method !== "GET") checkOrigin(req, config);
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && pathname === "/api/nutrition") {
        const store = await getStore(req);
        json(200, {
          ...(await store.view(nutritionDate(url.searchParams.get("date")))),
          aiAvailable: Boolean(config.openaiKey),
          localPreview: env().NUTRITION_LOCAL_PREVIEW === "true" && !env().VERCEL,
        });
      } else if (req.method === "GET" && pathname === "/api/nutrition/library")
        json(200, await (await getStore(req)).library());
      else if (req.method === "POST" && pathname === "/api/nutrition/library")
        json(200, await (await getStore(req)).changeLibrary(await bodyJson(req, 150000)));
      else if (req.method === "GET" && pathname === "/api/nutrition/search")
        json(200, { products: await catalog.search(url.searchParams.get("q")) });
      else if (req.method === "GET" && pathname === "/api/nutrition/product") {
        const product = await catalog.product(url.searchParams.get("barcode"));
        json(
          product ? 200 : 404,
          product
            ? { product }
            : {
                error:
                  "This barcode isn’t in Open Food Facts yet. Search for the food or add it manually.",
              }
        );
      } else if (req.method === "POST" && pathname === "/api/nutrition/estimate") {
        if (running >= 2)
          throw new NutritionError(
            "A food estimate is already running. Please try again shortly.",
            429
          );
        const payload = await bodyJson(req, 3000000);
        const controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), 60000);
        const stop = () => {
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", stop);
        running++;
        try {
          json(
            200,
            await estimate(payload, {
              key: config.openaiKey,
              model: env().NUTRITION_OPENAI_MODEL || config.model,
              signal: controller.signal,
            })
          );
        } finally {
          running--;
          clearTimeout(timer);
          res.off("close", stop);
        }
      } else if (req.method === "POST" && pathname === "/api/nutrition/entries")
        json(200, { day: await (await getStore(req)).change(await bodyJson(req, 150000)) });
      else if (req.method === "POST" && pathname === "/api/nutrition/targets")
        json(200, await (await getStore(req)).setTargets(await bodyJson(req, 10000)));
      else json(405, { error: "Nutrition endpoint or method not supported." });
    } catch (error) {
      json(error.status || 502, {
        error:
          error instanceof NutritionError || error.status
            ? error.message
            : "Nutrition couldn’t finish this request. Your saved log is unchanged. Please retry.",
      });
    }
    return true;
  };
}
