import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const configPath = fileURLToPath(new URL("../config.json", import.meta.url));

async function bootstrap() {
  let local = {};
  try {
    local = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch {}
  const environment = Object.fromEntries(
    ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SETTINGS_SCOPE"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]])
  );
  return process.env.VERCEL ? { ...local, ...environment } : { ...environment, ...local };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    );
  return value;
}

function sameJson(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

export function createAnnualPlanStore({ readBootstrap = bootstrap, fetchImpl = fetch } = {}) {
  async function config() {
    const value = await readBootstrap();
    const url = String(value.SUPABASE_URL || "").replace(/\/$/, "");
    const secret = value.SUPABASE_SECRET_KEY;
    const scope = value.SETTINGS_SCOPE || "default";
    if (!url || !secret) throw new Error("Supabase annual-plan storage is not configured.");
    return { url, secret, scope };
  }

  async function request(path, options = {}) {
    const { url, secret } = await config();
    const response = await fetchImpl(`${url}/rest/v1/annual_plans${path}`, {
      ...options,
      signal: AbortSignal.timeout(15_000),
      headers: {
        apikey: secret,
        ...(!String(secret).startsWith("sb_secret_") ? { Authorization: `Bearer ${secret}` } : {}),
        "Content-Type": "application/json",
        Accept: "application/json",
        "Cache-Control": "no-cache",
        ...options.headers,
      },
    });
    if (!response.ok) throw new Error(`Annual plan storage request failed (${response.status}).`);
    return response.status === 204 ? null : response.json();
  }

  return {
    async readAll() {
      const { scope } = await config();
      const rows = await request(
        `?scope=eq.${encodeURIComponent(
          scope
        )}&select=plan_id,plan,is_active,updated_at&order=updated_at.desc`
      );
      const plans = rows.map((row) => row.plan);
      const activeId = rows.find((row) => row.is_active)?.plan_id || plans[0]?.id || null;
      return { plans, activeId };
    },

    async replaceFromLegacy(plans, activeId) {
      const { scope } = await config();
      const normalized = Array.isArray(plans) ? plans : [];
      const existing = await this.readAll();
      if (
        existing.plans.length === normalized.length &&
        existing.activeId === (activeId || normalized[0]?.id || null) &&
        normalized.every((plan) =>
          existing.plans.some((candidate) => candidate.id === plan.id && sameJson(candidate, plan))
        )
      ) {
        return {
          plans: existing.plans,
          activeId: existing.activeId,
          verified: true,
          changed: false,
        };
      }

      await request(`?scope=eq.${encodeURIComponent(scope)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
      if (normalized.length) {
        const rows = normalized.map((plan) => ({
          scope,
          plan_id: plan.id,
          plan,
          is_active: plan.id === (activeId || normalized[0]?.id || null),
          updated_at: new Date().toISOString(),
        }));
        await request("?on_conflict=scope,plan_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify(rows),
        });
      }
      const after = await this.readAll();
      const expectedActive = activeId || normalized[0]?.id || null;
      const verified =
        after.plans.length === normalized.length &&
        after.activeId === expectedActive &&
        normalized.every((plan) =>
          after.plans.some((candidate) => candidate.id === plan.id && sameJson(candidate, plan))
        );
      if (!verified) throw new Error("Annual plan mirror verification failed.");
      return {
        plans: after.plans,
        activeId: after.activeId,
        verified: true,
        changed: true,
      };
    },

    async upsert(plan, activeId) {
      const { scope } = await config();
      await request(`?scope=eq.${encodeURIComponent(scope)}&is_active=eq.true`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          is_active: false,
          updated_at: new Date().toISOString(),
        }),
      });
      const rows = await request("?on_conflict=scope,plan_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify([
          {
            scope,
            plan_id: plan.id,
            plan,
            is_active: plan.id === activeId,
            updated_at: new Date().toISOString(),
          },
        ]),
      });
      const saved = rows?.[0]?.plan;
      if (!sameJson(saved, plan)) throw new Error("Annual plan write verification failed.");
      return saved;
    },

    async remove(planId, nextActiveId = null) {
      const { scope } = await config();
      await request(
        `?scope=eq.${encodeURIComponent(scope)}&plan_id=eq.${encodeURIComponent(planId)}`,
        {
          method: "DELETE",
          headers: { Prefer: "return=minimal" },
        }
      );
      if (nextActiveId) {
        await request(
          `?scope=eq.${encodeURIComponent(scope)}&plan_id=eq.${encodeURIComponent(nextActiveId)}`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              is_active: true,
              updated_at: new Date().toISOString(),
            }),
          }
        );
      }
      const after = await this.readAll();
      if (after.plans.some((plan) => plan.id === planId))
        throw new Error("Annual plan delete verification failed.");
      return after;
    },
  };
}
