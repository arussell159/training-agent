import { NutritionError } from "./nutrition-model.mjs";

// Provider messages may contain signed request parameters; never relay them.
export async function fatSecretResponse(response) {
  if (!response.ok) {
    const error = new NutritionError(
      response.status === 429
        ? "FatSecret’s request limit was reached. Wait before retrying."
        : response.status === 401 || response.status === 403
          ? "FatSecret could not authorize this server. Check API credentials, access and allowed IP address."
          : "FatSecret is temporarily unavailable. Please retry.",
      response.status === 429 ? 429 : 502
    );
    error.transient = response.status >= 500;
    error.authentication = response.status === 401;
    if (response.status === 429) {
      const raw = response.headers.get("retry-after");
      const seconds = Number(raw) || (Date.parse(raw || "") - Date.now()) / 1000;
      error.retryAfter =
        Number.isFinite(seconds) && seconds > 0 ? Math.min(86400, Math.ceil(seconds)) : 30;
    }
    throw error;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new NutritionError("FatSecret returned an unreadable response. Please retry.", 502);
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new NutritionError("FatSecret returned an incomplete response. Please retry.", 502);
  if (data.error) {
    const code = Number(data.error.code);
    const error = new NutritionError(
      [11, 12].includes(code)
        ? "FatSecret’s request limit was reached. Wait before retrying."
        : code === 21
          ? "FatSecret rejected this server's IP address. Add your public IP under Allowed IP addresses in your FatSecret API account, then retry."
          : [2, 3, 4, 5, 6, 7, 8, 9, 13, 14].includes(code)
            ? "FatSecret denied this request. Check API credentials, access and allowed IP address."
            : code === 24
              ? "FatSecret timed out. Please retry."
              : "FatSecret could not complete this request. Please retry.",
      [11, 12].includes(code) ? 429 : code === 24 ? 504 : 502
    );
    error.providerCode = code;
    error.transient = code === 20;
    error.authentication = code === 13;
    if ([11, 12].includes(code)) error.retryAfter = 30;
    throw error;
  }
  return data;
}
