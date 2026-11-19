export const siteConsentCookie = "shanhai-site-consent";
export const siteConsentVersion = "2026-11-19";
export const siteConsentDays = 365;
export const siteConsentPath = "/welcome";
export const siteConsentAction = "/api/site-consent";
export const siteConsentRequiredHeader = "x-shanhai-consent-required";

export function siteConsentDestination(value?: string | null) {
  if (!value?.startsWith("/") || value.length > 4096) return "/";
  const origin = "https://site-consent.invalid";
  const url = URL.parse(value, origin);
  if (!url || url.origin !== origin || url.pathname.startsWith("//") || url.pathname === siteConsentPath) return "/";
  if (url.searchParams.has("_rsc")) url.searchParams.delete("_rsc");
  return url.pathname + url.search + url.hash;
}
