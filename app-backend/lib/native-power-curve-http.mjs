export function createNativePowerCurveEndpoint({
  service,
  readConfig,
  readTimeZone = async () => "America/Chicago",
}) {
  return async (req, res) => {
    const json = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "private,no-store",
      });
      res.end(JSON.stringify(body));
    };
    try {
      if (!req.appActor?.id || !req.appActor?.origin)
        return json(401, {
          error: "Sign in to load recorded native power.",
          code: "NATIVE_POWER_AUTH",
        });
      if (req.method !== "GET")
        return json(405, {
          error: "Recorded native power is read-only.",
          code: "NATIVE_POWER_METHOD",
        });
      const params = new URL(req.url, "http://localhost").searchParams,
        keys = [...params.keys()];
      if (
        new Set(keys).size !== keys.length ||
        keys.some((key) => !["kind", "sport", "start", "end"].includes(key))
      )
        return json(400, {
          error: "Choose supported native power options.",
          code: "NATIVE_POWER_INVALID",
        });
      return json(
        200,
        await service.load(await readConfig(), Object.fromEntries(params), {
          actor: req.appActor,
          timeZone: await readTimeZone(),
        })
      );
    } catch (error) {
      const known = [
        "NATIVE_POWER_AUTH",
        "NATIVE_POWER_INVALID",
        "NATIVE_POWER_BUSY",
        "NATIVE_POWER_UNAVAILABLE",
      ].includes(error?.code);
      json(known ? error.status : 502, {
        error: known ? error.message : "Recorded native power could not be verified. Please retry.",
        code: known ? error.code : "NATIVE_POWER_UNAVAILABLE",
      });
    }
  };
}
