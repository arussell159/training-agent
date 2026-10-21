// Preview instrumentation records attempts, not proof of a committed mutation.
export function recordPreviewProviderWrite(ledger, path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return;
  let body = null,
    invalidBody = false;
  if (options.body !== undefined && options.body !== null && options.body !== "") {
    try {
      body = JSON.parse(String(options.body));
    } catch {
      invalidBody = true;
    }
  }
  ledger.push({ path, method, body, ...(invalidBody ? { invalidBody: true } : {}) });
}
