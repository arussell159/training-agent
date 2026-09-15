import { toFunctionUrl } from "../../../app-backend/lib/api-routing.mjs"

export function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(toFunctionUrl(path), options)
}
