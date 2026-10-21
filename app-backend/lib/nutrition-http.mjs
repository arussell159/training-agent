import { bodyJson, checkOrigin } from "./coach-http.mjs";
import { coachConfig } from "./github-coach.mjs";
import { NutritionError, nutritionDate, validateEntry } from "./nutrition-model.mjs";
import { createFoodCatalog, estimateFood } from "./nutrition-fatsecret.mjs";

export function createNutritionHttp({
  getStore,
  env = () => process.env,
  catalog = createFoodCatalog({ env }),
  estimate = estimateFood,
}) {
  let running = 0;
  const views = new Map();
  const hydrate = (entry, signal) => (catalog.hydrate ? catalog.hydrate(entry, signal) : entry);
  const resolveWrites = (entries) => {
    if (!Array.isArray(entries) || !entries.length || entries.length > 30)
      throw new NutritionError("Save between 1 and 30 foods at a time.");
    return Promise.all(entries.map((entry) => hydrate(validateEntry(entry))));
  };
  return async (req, res, pathname) => {
    if (pathname !== "/api/nutrition" && !pathname.startsWith("/api/nutrition/")) return false;
    const started = performance.now();
    const catalogRead = async (read) => {
      const controller = new AbortController();
      const stop = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on("close", stop);
      try {
        return await read(controller.signal);
      } finally {
        res.off("close", stop);
      }
    };
    const json = (status, data, headers = {}) => {
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Server-Timing": `nutrition;dur=${(performance.now() - started).toFixed(1)}`,
          ...headers,
        });
        res.end(JSON.stringify(data));
      }
    };
    try {
      if (!req.appSession) throw new NutritionError("Sign in to view your food log.", 401);
      const config = coachConfig(env());
      if (req.method !== "GET") {
        checkOrigin(req, config);
        views.clear();
      }
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && pathname === "/api/nutrition") {
        const date = nutritionDate(url.searchParams.get("date"));
        // This installation is single-user. Keep in-flight sharing isolated
        // by host, settings realm and provider account; never cache Basic
        // catalog response values after the operation settles.
        const key = JSON.stringify([
          req.headers.host,
          env().SETTINGS_SCOPE || "default",
          env().FATSECRET_CONSUMER_KEY || env().FATSECRET_CLIENT_ID || "unconfigured",
          date,
        ]);
        const cached = views.get(key);
        if (cached) {
          json(200, await cached.promise);
          return true;
        }
        const promise = (async () => {
          const store = await getStore(req);
          return {
            ...(await store.view(date, hydrate)),
            aiAvailable: Boolean(config.openaiKey),
            localPreview: env().NUTRITION_LOCAL_PREVIEW === "true" && !env().VERCEL,
          };
        })();
        const entry = { promise };
        views.set(key, entry);
        if (views.size > 32) views.delete(views.keys().next().value);
        try {
          json(200, await promise);
        } catch (error) {
          if (views.get(key) === entry) views.delete(key);
          throw error;
        } finally {
          if (views.get(key) === entry) views.delete(key);
        }
      } else if (req.method === "GET" && pathname === "/api/nutrition/library")
        json(200, await (await getStore(req)).library(hydrate));
      else if (req.method === "POST" && pathname === "/api/nutrition/library") {
        const payload = await bodyJson(req, 150000);
        if (payload.item?.entries) payload.item.entries = await resolveWrites(payload.item.entries);
        const store = await getStore(req);
        await store.changeLibrary(payload);
        json(200, await store.library(hydrate));
      } else if (req.method === "GET" && pathname === "/api/nutrition/search")
        json(200, {
          products: await catalogRead((signal) =>
            catalog.search(url.searchParams.get("q"), signal)
          ),
        });
      else if (req.method === "GET" && pathname === "/api/nutrition/product") {
        const product = await catalogRead((signal) =>
          catalog.product(url.searchParams.get("id"), signal)
        );
        json(
          product ? 200 : 404,
          product
            ? { product }
            : {
                error: "This food is not available in FatSecret. Try another search.",
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
              catalog,
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
      } else if (req.method === "POST" && pathname === "/api/nutrition/entries") {
        const payload = await bodyJson(req, 150000);
        const store = await getStore(req);
        // Read the durable receipt before any provider work. A response lost after
        // commit must remain recoverable even while the catalog is unavailable.
        let saved = store.receipt ? await store.receipt(payload.date, payload.operationId) : null;
        const replayed = Boolean(saved);
        if (!saved) {
          if (payload.entries) payload.entries = await resolveWrites(payload.entries);
          saved = await store.change(payload);
        }
        const resolved = new Map(
          (replayed ? [] : payload.entries || []).map((entry) => [entry.id, entry])
        );
        const entries = saved.entries.map((entry) =>
          entry.source === "fatsecret" ? resolved.get(entry.id) : entry
        );
        // No provider request after commit: the client retains its hydrated
        // optimistic day when older catalog entries need a separate refresh.
        json(200, {
          day: entries.every((entry) => entry?.name) ? { ...saved, entries } : null,
          committed: true,
          revision: saved.revision,
        });
      } else if (req.method === "POST" && pathname === "/api/nutrition/targets")
        json(200, await (await getStore(req)).setTargets(await bodyJson(req, 10000)));
      else json(405, { error: "Nutrition endpoint or method not supported." });
    } catch (error) {
      json(
        error.status || 502,
        {
          ...(Number.isInteger(error.providerCode) ? { providerCode: error.providerCode } : {}),
          error:
            error instanceof NutritionError || error.status
              ? error.message
              : "Nutrition couldn’t finish this request. Your saved log is unchanged. Please retry.",
        },
        error.status === 429 && Number.isFinite(error.retryAfter)
          ? { "Retry-After": String(Math.max(1, Math.ceil(error.retryAfter))) }
          : {}
      );
    }
    return true;
  };
}
