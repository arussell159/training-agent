// Shared, credential-free routing for localhost and Vercel's single API function.
export function toFunctionUrl(path) {
  const url = new URL(path,'http://localhost');
  if (!url.pathname.startsWith('/api/') || url.pathname === '/api/handler') return path;
  const query = new URLSearchParams(url.search);
  query.set('__api_route',url.pathname.slice('/api/'.length));
  return `/api/handler?${query}`;
}

export function resolveApiRoute(requestUrl) {
  const url = new URL(requestUrl,'http://localhost');
  if (url.pathname !== '/api/handler') return requestUrl;
  const route = url.searchParams.get('__api_route');
  if (!route || route.startsWith('/') || route.includes('..')) throw new Error('Invalid API route');
  url.searchParams.delete('__api_route');
  return `/api/${route}${url.search}`;
}
