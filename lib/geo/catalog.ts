import { homeAds } from "../catalog/home-ads";
import { getSite, publicCategoryAllowed, publicEditorial } from "../directory/read";
import { siteUrl } from "../site";
import type { ContentVisibility } from "./visibility";

export function catalogLinkAllowed(visibility: ContentVisibility, href: string) {
  if (!visibility.linkAllowed(href)) return false;
  const base = siteUrl();
  let url: URL;
  try { url = new URL(href, base); } catch { return false; }
  if (url.origin !== base.origin) return true;
  const [,section,id] = url.pathname.split("/");
  if (!id) return true;
  if (section === "categories") return publicCategoryAllowed(id,visibility);
  if (section === "services") return !!getSite(id,undefined,visibility);
  if (section === "observations") return !!publicEditorial(id,undefined,visibility);
  return true;
}

export function visibleHomeAds(visibility: ContentVisibility) {
  return homeAds.filter(ad => visibility.allows("ad",ad.id,ad.network) && visibility.linkAllowed(ad.href));
}
