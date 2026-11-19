import { getGuide } from "../catalog";
import { homeAds } from "../catalog/home-ads";
import type { Guide } from "../catalog/types";
import { getSite, publicEditorial } from "../directory/read";
import { siteUrl } from "../site";
import type { ContentVisibility } from "./visibility";

export function guideAllowed(visibility: ContentVisibility, guide: Guide) {
  return visibility.allows("guide", guide.id, guide.network);
}

export function catalogLinkAllowed(visibility: ContentVisibility, href: string) {
  if (!visibility.linkAllowed(href)) return false;
  const base = siteUrl();
  let url: URL;
  try { url = new URL(href, base); } catch { return false; }
  if (url.origin !== base.origin) return true;
  const [,section,id] = url.pathname.split("/");
  if (!id) return true;
  if (section === "categories") return visibility.categoryAllowed(id);
  if (section === "services") return !!getSite(id,undefined,visibility);
  if (section === "observations") return !!publicEditorial(id,undefined,visibility);
  if (section !== "guides") return true;
  const guide = getGuide(id);
  return !!guide && guideAllowed(visibility,guide);
}

export function visibleHomeAds(visibility: ContentVisibility) {
  return homeAds.filter(ad => visibility.allows("ad",ad.id,ad.network) && visibility.linkAllowed(ad.href));
}
