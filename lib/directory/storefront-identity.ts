import { websiteUrl } from "./validation";

const platformHosts: Record<string, string> = {
  "wzyp.cn": "wzyp.cn",
  "ldxp.cn": "wzyp.cn",
  "pay.ldxp.cn": "wzyp.cn",
  "16688.com.cn": "16688.com.cn",
  "catfk.com": "catfk.com",
};

export function storefrontIdentity(value: string) {
  const entry = websiteUrl(value);
  const platform = platformHosts[entry.domain];
  if (!platform) return null;
  const url = new URL(entry.url);
  const match = /^\/shop\/([A-Za-z0-9_-]{1,80})\/?$/.exec(url.pathname);
  if (!match || (platform === "16688.com.cn" && !/^s\d+$/i.test(match[1]))) return null;
  const handle = platform === "16688.com.cn" ? match[1].toUpperCase() : match[1];
  url.pathname = "/shop/" + handle;
  url.search = "";
  return { key: platform + "/" + handle, url: url.href, host: entry.domain, registrable: entry.registrable };
}

export function isStorefrontPlatform(domain: string) {
  return Object.hasOwn(platformHosts, domain);
}

export function storefrontProductPlatform(value: string) {
  try {
    const url = new URL(websiteUrl(value).url);
    if (url.protocol!=="https:" || url.search) return null;
    const platform = platformHosts[url.hostname.replace(/^www\./,"")];
    if (platform==="16688.com.cn") return /^\/goods\/G\d+$/.test(url.pathname)?platform:null;
    if (platform==="wzyp.cn" || platform==="catfk.com") {
      return /^\/item\/[A-Za-z0-9_-]{1,80}$/.test(url.pathname)?platform:null;
    }
    return null;
  } catch { return null; }
}

export function priceMemoProductStorefront(sourcePlatform: string, token: string, productUrl: string) {
  const platform=storefrontProductPlatform(productUrl);
  if (platform==="16688.com.cn" && sourcePlatform==="16688" && /^16688-S\d{3,12}$/.test(token)) {
    return storefrontIdentity("https://www.16688.com.cn/shop/"+token.slice(6));
  }
  if (platform==="catfk.com" && ["ldxp","catfk"].includes(sourcePlatform) && /^catfk:[A-Za-z0-9_-]{1,80}$/.test(token)) {
    return storefrontIdentity("https://catfk.com/shop/"+token.slice(6));
  }
  if (platform==="wzyp.cn" && sourcePlatform==="ldxp" && /^[A-Za-z0-9_-]{1,80}$/.test(token)) {
    return storefrontIdentity("https://wzyp.cn/shop/"+token);
  }
  return null;
}
