import { handleRequest } from "../app-backend/server.mjs"

export default function handler(req, res) {
  const url = new URL(req.url, "http://localhost")
  const route = url.searchParams.get("__api_route")
  if (route !== null) {
    url.searchParams.delete("__api_route")
    req.url = `/api/${route}${url.search}`
  }
  return handleRequest(req, res)
}
