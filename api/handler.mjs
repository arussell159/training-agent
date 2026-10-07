import { createAppAuth } from "../app-backend/lib/app-auth.mjs"
import { resolveApiRoute } from "../app-backend/lib/api-routing.mjs"

// Session verification is on every cold page's critical path. It needs neither
// the training provider clients nor report/workout processing modules.
export function createApiHandler({
  authenticate = createAppAuth(),
  loadServer = () => import("../app-backend/server.mjs"),
  hosted = () => Boolean(process.env.VERCEL && process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY),
} = {}) {
  return async function handler(req, res) {
    req.url = resolveApiRoute(req.url)
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (hosted() && req.method === 'GET' && pathname === '/api/auth/session')
      return authenticate(req, res, pathname)
    const { handleRequest } = await loadServer()
    return handleRequest(req, res)
  }
}

export default createApiHandler()
