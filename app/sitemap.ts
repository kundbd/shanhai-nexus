import type { MetadataRoute } from "next";
import { guideHref, guides, toolHref, tools } from "@/lib/catalog";
import { siteUrl } from "@/lib/site";
import { listPublicCategories,listSites,publicEditorials } from "@/lib/directory/read";
import { categoryHref,siteHref,observationHref } from "@/lib/directory/types";
import { guideAllowed } from "@/lib/geo/catalog";
import { universalVisibility } from "@/lib/geo/request";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl();
  const visibility = universalVisibility();
  return [
    ...["/", "/tools", "/guides", "/diagnose", "/about", "/services", "/rankings", "/community", "/messages", "/observations", "/updates", "/policy", "/contact", ...tools.map((tool) => toolHref(tool.id))]
      .map((path) => ({ url: new URL(path, origin).href })),
    ...guides.filter(guide=>guideAllowed(visibility,guide)).map((guide) => ({ url: new URL(guideHref(guide.id), origin).href, lastModified: new Date(guide.verified) })),
    ...listPublicCategories(undefined,visibility).map((item)=>({url:new URL(categoryHref(item.slug),origin).href})),
    ...listSites({showAll:true,visibility}).rows.map((site)=>({url:new URL(siteHref(site.slug),origin).href,lastModified:new Date(site.updated_at)})),
    ...publicEditorials(undefined, -1, undefined, visibility).map((entry)=>({url:new URL(observationHref(entry.slug),origin).href,lastModified:new Date(entry.updated_at)})),
  ];
}
