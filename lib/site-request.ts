export function sameOriginBrowserRequest(request:Request) {
  const fetchSite=request.headers.get("sec-fetch-site");
  // Browsers compute this against the public URL, even behind a reverse proxy.
  if (fetchSite) return fetchSite==="same-origin";
  const origin=request.headers.get("origin");
  if (!origin) return false;
  const expected=[new URL(request.url).origin];
  if (process.env.SITE_URL) {
    try { expected.push(new URL(process.env.SITE_URL).origin); } catch { /* The request origin remains available. */ }
  }
  return expected.includes(origin);
}
