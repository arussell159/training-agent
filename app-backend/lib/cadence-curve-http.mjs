export function createCadenceCurveEndpoint({
  service,
  readConfig,
  readTimeZone = async () => "America/Chicago",
}) {
  return async (req, res) => {
    const json = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "private,no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (!req.appActor?.id || !req.appActor?.origin)
        return json(401, {
          error: "Sign in to load recorded cadence.",
          code: "CADENCE_CURVE_AUTH",
        });
      if (req.method !== "GET")
        return json(405, {
          error: "Recorded cadence curves are read-only.",
          code: "CADENCE_CURVE_METHOD",
        });
      const url = new URL(req.url, "http://localhost"),
        keys = [...url.searchParams.keys()];
      if (
        keys.some((key) => !["kind", "sport", "start", "end", "tags"].includes(key)) ||
        new Set(keys).size !== keys.length
      )
        return json(400, {
          error: "Choose supported cadence curve options.",
          code: "CADENCE_CURVE_INVALID",
        });
      return json(
        200,
        await service.load(await readConfig(), Object.fromEntries(url.searchParams), {
          actor: req.appActor,
          timeZone: await readTimeZone(),
        })
      );
    } catch (error) {
      const known = [
        "CADENCE_CURVE_AUTH",
        "CADENCE_CURVE_INVALID",
        "CADENCE_FILTER_UNSUPPORTED",
        "CADENCE_CURVE_UNAVAILABLE",
        "CADENCE_CURVE_BUSY",
      ].includes(error?.code);
      return json(known ? error.status : 502, {
        error: known ? error.message : "Recorded cadence could not be verified. Please retry.",
        code: known ? error.code : "CADENCE_CURVE_UNAVAILABLE",
      });
    }
  };
}
