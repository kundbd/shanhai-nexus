export const siteConsentCookie = "shanhai-site-consent";
export const siteConsentVersion = "2026-11-19.2";
export const siteConsentDays = 365;
export const siteConsentPath = "/welcome";
export const siteConsentAction = "/api/site-consent";
export const siteConsentRequiredHeader = "x-shanhai-consent-required";
export const siteServiceRegionClause = "本站相关服务仅在符合当地法律法规及本站服务政策的地区提供。访问者应遵守所在地适用法律法规。";

export const siteAgreementTerms = [
  "本站仅提供商家信息及来源，不对商品和商家负责。",
  "禁止利用本站信息进行违法犯罪活动，一经发现，后果自负。",
  "不支持地区的用户禁止通过不法手段访问本站。",
  siteServiceRegionClause,
] as const;

export function siteConsentDestination(value?: string | null) {
  if (!value?.startsWith("/") || value.length > 4096) return "/";
  const origin = "https://site-consent.invalid";
  const url = URL.parse(value, origin);
  if (!url || url.origin !== origin || url.pathname.startsWith("//") || url.pathname === siteConsentPath) return "/";
  if (url.searchParams.has("_rsc")) url.searchParams.delete("_rsc");
  return url.pathname + url.search + url.hash;
}
