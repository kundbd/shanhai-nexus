import type { DatabaseSync } from "node:sqlite";
import { trafficProduct } from "../traffic-path";
import { all } from "./db";
import { currentPublicProducts } from "./products";
import { isRetiredCategory,pipelines,type Pipeline } from "./taxonomy";
import { trafficWindow } from "./traffic";
import type { Price,Site } from "./types";

const limit=20;
export type RankingPeriod="24h"|"overall";
type RankedShop=Pick<Site,"id"|"slug"|"name"|"category_slug"|"category_label"|"avatar_digest">&{visitors:number};
type RankedProduct={path:string;visitors:number;site:Pick<Site,"id"|"slug"|"name"|"category_slug"|"category_label">;price:Price};

const categories=(group:Pipeline)=>JSON.stringify(pipelines[group].categories.filter(category=>!isRetiredCategory(category)));

function visitorCounts(kind:"services"|"products",period:RankingPeriod,time:number) {
  const range=[`/${kind}/`,`/${kind}0`];
  if (period==="overall") return {
    sql:"SELECT page,visitors FROM ranking_pages WHERE page>=? AND page<? AND visitors>0",
    params:range,
  };
  const {minute,cutoff}=trafficWindow(time);
  return {
    sql:`SELECT page,count(*) visitors FROM traffic_visitors WHERE page>=? AND page<? AND last_seen>? AND last_seen<=? GROUP BY page`,
    params:[...range,cutoff,minute],
  };
}

export function shopRanking(db:DatabaseSync,group:Pipeline,period:RankingPeriod="24h",time=Date.now()) {
  const counts=visitorCounts("services",period,time);
  return all<RankedShop>(db,`WITH counts AS (${counts.sql})
    SELECT s.id,s.slug,s.name,s.category_slug,c.label category_label,a.digest avatar_digest,v.visitors
    FROM sites s JOIN counts v ON v.page='/services/'||s.slug
    JOIN categories c ON c.slug=s.category_slug
    LEFT JOIN merchant_avatars a ON a.site_id=s.id AND a.website=s.website
    WHERE s.publication='published' AND s.lifecycle<>'closed' AND s.category_slug IN (SELECT value FROM json_each(?))
    ORDER BY v.visitors DESC,s.name COLLATE NOCASE,s.id LIMIT ?`,...counts.params,categories(group),limit);
}

export function productRanking(db:DatabaseSync,group:Pipeline,period:RankingPeriod="24h",time=Date.now()) {
  const counts=visitorCounts("products",period,time);
  const visits=db.prepare(`WITH counts AS (${counts.sql})
    SELECT v.page path,v.visitors,s.id,s.slug,s.name,s.category_slug,c.label category_label
    FROM counts v JOIN sites s ON s.id=CAST(substr(v.page,length('/products/')+1) AS INTEGER)
    JOIN categories c ON c.slug=s.category_slug
    WHERE s.publication='published' AND s.lifecycle<>'closed' AND s.category_slug IN (SELECT value FROM json_each(?))
    ORDER BY v.visitors DESC,v.page`).iterate(...counts.params,categories(group)) as Iterable<Omit<RankedProduct,"site"|"price">&RankedProduct["site"]>;
  const result:RankedProduct[]=[];
  const products=new Map<number,ReturnType<typeof currentPublicProducts>>();
  for (const {path,visitors,...site} of visits) {
    const key=trafficProduct(path)?.key;
    if (!key) continue;
    let available=products.get(site.id);
    if (!available) {
      available=currentPublicProducts(db,site.id);
      products.set(site.id,available);
    }
    const price=available.get(key);
    if (price) {
      result.push({path,visitors,site,price});
      if (result.length===limit) break;
    }
  }
  return result;
}
