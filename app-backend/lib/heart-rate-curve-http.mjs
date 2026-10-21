export function createHeartRateCurveEndpoint({
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
          error: "Sign in to load recorded heart-rate history.",
          code: "HR_CURVE_AUTH",
        });
      if (req.method !== "GET")
        return json(405, {
          error: "Recorded heart-rate curves are read-only.",
          code: "HR_CURVE_METHOD",
        });
      const url = new URL(req.url, "http://localhost"),
        keys = [...url.searchParams.keys()];
      if (
        keys.some((key) => !["kind", "sport", "start", "end"].includes(key)) ||
        new Set(keys).size !== keys.length
      )
        return json(400, { error: "Choose supported HR curve options.", code: "HR_CURVE_INVALID" });
      const config = await readConfig(),
        timeZone = await readTimeZone();
      return json(
        200,
        await service.load(config, Object.fromEntries(url.searchParams), {
          actor: req.appActor,
          timeZone,
        })
      );
    } catch (error) {
      const known = [
        "HR_CURVE_AUTH",
        "HR_CURVE_INVALID",
        "HR_CURVE_UNAVAILABLE",
        "HR_CURVE_BUSY",
      ].includes(error?.code);
      return json(known ? error.status : 502, {
        error: known
          ? error.message
          : "Recorded heart-rate history could not be verified. Please retry.",
        code: known ? error.code : "HR_CURVE_UNAVAILABLE",
      });
    }
  };
}
