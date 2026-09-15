import { handleRequest } from "../app-backend/server.mjs"
import { resolveApiRoute } from "../app-backend/lib/api-routing.mjs"

export default function handler(req, res) {
  req.url = resolveApiRoute(req.url)
  return handleRequest(req, res)
}
