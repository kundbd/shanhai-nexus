import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { all, one, transaction } from "./db";
import { isStorefrontPlatform, storefrontIdentity, storefrontProductPlatform } from "./storefront-identity";
import { choice, now, textValue, websiteUrl } from "./validation";
import { audit, persist } from "./write";

type Offer = { plan: string; cnyMinor: number; period: string; region?: string; notes?: string; productTitle?:string };
export type StorefrontObservation = {
  name: string;
  website: string;
  sourceUrl: string;
  discoveryUrl?: string;
  observedAt: string;
  category: "ai-topup" | "ai-card";
  offers: (Offer & {availability?: "available" | "unavailable"})[];
  relatedStorefronts?: string[];
  reportedItemUrl?: string;
};
type Existing = { id: number; slug: string; publication: string; category_slug: string; lifecycle:string };

const hash = (value:string) => createHash("sha256").update(value).digest("hex");

function publicUrl(raw:string) {
  const result = websiteUrl(textValue(raw,1500,"公开链接"));
  const url = new URL(result.url);
  if (url.search) throw new Error("报价证据须使用不含查询参数的公开链接。");
  return result;
}

function offersFor(rows:Offer[]) {
  if (!Array.isArray(rows) || !rows.length || rows.length>50) throw new Error("每家店须有 1 至 50 个可核对的人民币报价。");
  const offers = new Map<string, Required<Offer>>();
  for (const row of rows) {
    const plan = textValue(row.plan,150,"商品");
    const period = textValue(row.period,45,"计费周期");
    const region = textValue(row.region,80,"计价地区",false) || "未注明";
    const notes = textValue(row.notes,250,"报价说明",false);
    const cnyMinor = row.cnyMinor;
    if (!Number.isSafeInteger(cnyMinor) || cnyMinor<=0 || cnyMinor>100_000_000) throw new Error("公开人民币报价无效。");
    const key = JSON.stringify([plan,period,region]);
    if (offers.has(key) && offers.get(key)!.cnyMinor!==cnyMinor) throw new Error("同一商品有多个不同报价，须注明规格。");
    offers.set(key,{plan,cnyMinor,period,region,notes,productTitle:textValue(row.productTitle,180,"商品原名",false)});
  }
  return [...offers.values()];
}

export function writeStorefrontObservation(db:DatabaseSync,row:StorefrontObservation,actor:string) {
  const name = textValue(row.name,100,"店名");
  const siteUrl = publicUrl(row.website);
  const storefront = storefrontIdentity(siteUrl.url);
  const source = publicUrl(row.sourceUrl);
  const discovery = row.discoveryUrl ? websiteUrl(row.discoveryUrl).url : null;
  const observedAt = textValue(row.observedAt,30,"观察时间");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt) ||
    !Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString()!==observedAt || Date.parse(observedAt)>Date.now()) throw new Error("观察时间无效。");
  const category = choice(row.category,["ai-topup","ai-card"] as const,"分类");
  const offers = offersFor(row.offers);
  if (!storefront && isStorefrontPlatform(siteUrl.domain)) throw new Error("发卡平台须提供独立店铺链接。");
  const reportedItem = row.reportedItemUrl == null ? null : publicUrl(row.reportedItemUrl).url;
  if (reportedItem) {
    const platform=storefrontProductPlatform(reportedItem);
    if (offers.length!==1 || row.relatedStorefronts?.length ||
      !platform || !storefront?.key.startsWith(platform+"/") ||
      !/^https:\/\/ai\.pricememo\.cn\/data\/v1\/snapshots\/\d+\.json$/.test(source.url)) {
      throw new Error("第三方观测须提供 PriceMemo 快照、同一平台的原商品页和一条报价。");
    }
  } else if (storefront ? storefrontIdentity(source.url)?.key!==storefront.key : source.registrable!==siteUrl.registrable) {
    throw new Error("报价来源须为店铺本身所公开的页面。");
  }
  if (row.relatedStorefronts && (!Array.isArray(row.relatedStorefronts)||row.relatedStorefronts.length>12)) throw new Error("关联店铺列表无效。");
  const related = (row.relatedStorefronts??[]).map(raw=>{
    const relatedSite = storefrontIdentity(publicUrl(raw).url);
    if (!relatedSite) throw new Error("关联店铺须提供独立店铺链接。");
    return relatedSite;
  });
  const links = new Map([...related,...(storefront?[storefront]:[])].map(link=>[link.key,link]));
  const ids = new Set<number>();
  for (const key of links.keys()) {
    const stored = one<{site_id:number}>(db,"SELECT site_id FROM merchant_storefronts WHERE storefront_key=?",key);
    if (stored) ids.add(stored.site_id);
  }
  if (!storefront) {
    for (const match of all<{site_id:number}>(db,"SELECT DISTINCT site_id FROM site_domains WHERE registrable=?",siteUrl.registrable)) ids.add(match.site_id);
  } else {
    // Earlier admission runs could assign a whole platform host to the first recorded shop.
    for (const match of all<{id:number;website:string}>(db,`SELECT DISTINCT s.id,s.website FROM sites s
      JOIN site_domains d ON d.site_id=s.id WHERE d.registrable=?`,siteUrl.registrable)) {
      if (storefrontIdentity(match.website)?.key===storefront.key) ids.add(match.id);
    }
  }
  if (ids.size>1) throw new Error("关联到多个现有档案，须先合并已确认相同的店铺。");
  const existing = one<Existing>(db,"SELECT id,slug,publication,category_slug,lifecycle FROM sites WHERE id=?",ids.values().next().value ?? null);
  if (existing && (existing.publication!=="published" || existing.lifecycle==="closed" || !["ai-topup","ai-card"].includes(existing.category_slug))) {
    throw new Error("该店已有未公开档案或分类不同，需核对归属。");
  }
  const canonical = storefront?.url ?? siteUrl.url;
  const slug = existing?.slug ?? "store-" + hash(storefront?.key ?? siteUrl.registrable).slice(0,20);
  const siteId = existing?.id ?? Number(persist(db,"sites",{
    slug, name,website:canonical,category_slug:category,
    summary:storefront ? "发卡平台内独立店铺。公开商品和人民币页面标价见价格记录。" : "AI 会员商品店铺。公开商品和人民币页面标价见价格记录。",
    status:"listed",publication:"published",operator_kind:"third_party",lifecycle:"unknown",
    added_at:now(),updated_at:now(),checked_at:reportedItem?null:observedAt,reachability:reportedItem?"unchecked":"reachable",basis:"basic",
  }));
  const aliasAdded = !storefront && (!existing || links.size>0) && Number(db.prepare(
    "INSERT OR IGNORE INTO site_domains(domain,site_id,kind,registrable) VALUES (?,?,?,?)",
  ).run(siteUrl.domain,siteId,existing?"alias":"primary",siteUrl.registrable).changes)>0;
  const insertLink = db.prepare(`INSERT INTO merchant_storefronts(storefront_key,site_id,url,host,source_url,discovery_url,observed_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(storefront_key) DO NOTHING`);
  let linked = 0;
  for (const link of links.values()) linked += Number(insertLink.run(link.key,siteId,link.url,link.host,source.url,discovery,observedAt).changes);
  const observationNotes=(notes:string)=>((reportedItem?"PriceMemo 第三方公开观测，价格与可售状态以原商品页为准。":"店铺标价。")+notes).trim();
  const sameProduct=`((? IS NULL AND p.reported_item_url IS NULL AND src.url=?) OR p.reported_item_url=?)`;
  let titles=0;
  const changed = offers.filter(offer=>{
    const simultaneous = one<{id:number;amount_minor:number;product_title:string|null}>(db,`SELECT p.id,p.amount_minor,p.product_title FROM price_records p
      JOIN sources src ON src.id=p.source_id WHERE p.site_id=? AND p.plan=? AND p.currency='CNY' AND p.period=? AND p.region=?
      AND p.storefront_observed=1 AND p.recorded_at=? AND ${sameProduct}`,siteId,offer.plan,offer.period,offer.region,observedAt,reportedItem,source.url,reportedItem);
    if (simultaneous) {
      if (simultaneous.amount_minor!==offer.cnyMinor) throw new Error("同一时刻的同规格报价存在冲突。");
      if (!simultaneous.product_title&&offer.productTitle) {
        db.prepare("UPDATE price_records SET product_title=? WHERE id=?").run(offer.productTitle,simultaneous.id);
        titles++;
      }
      return false;
    }
    const latest = one<{amount_minor:number;recorded_at:string;notes:string;product_title:string|null}>(db,`SELECT p.amount_minor,p.recorded_at,p.notes,p.product_title FROM price_records p
      JOIN sources src ON src.id=p.source_id WHERE p.site_id=? AND p.plan=? AND p.currency='CNY' AND p.period=? AND p.region=?
      AND p.publication='published' AND p.storefront_observed=1
      AND ${sameProduct}
      ORDER BY p.recorded_at DESC,p.id DESC LIMIT 1`,siteId,offer.plan,offer.period,offer.region,reportedItem,source.url,reportedItem);
    return !latest || (latest.recorded_at<observedAt && (latest.amount_minor!==offer.cnyMinor || latest.notes!==observationNotes(offer.notes) ||
      Boolean(offer.productTitle&&offer.productTitle!==latest.product_title)));
  });
  if (changed.length) {
    const excerpt = changed.map(({plan,cnyMinor,period})=>`${plan} · CNY ${(cnyMinor/100).toFixed(2)} · ${period}`).join("\n").slice(0,2600);
    const kind=reportedItem?"media":"official";
    const title=reportedItem?"PriceMemo 公开观测快照":"店铺公开商品标价";
    db.prepare(`INSERT OR IGNORE INTO sources(site_id,title,url,accessed_at,kind,verified,excerpt,digest,attribution)
      VALUES (?,?,?,?,?,1,?,?,?)`).run(siteId,title,source.url,observedAt,kind,excerpt,hash(excerpt),reportedItem?"AI Price Memory（PriceMemo）":null);
    const sourceId = one<{id:number}>(db,`SELECT id FROM sources WHERE site_id=? AND url=? AND accessed_at=?
      AND verified=1 AND kind=?`,siteId,source.url,observedAt,kind)?.id;
    if (!sourceId) throw new Error("同时间的来源记录冲突。");
    for (const offer of changed) db.prepare(`INSERT INTO price_records(site_id,source_id,plan,amount_minor,currency,period,region,notes,recorded_at,publication,storefront_observed,reported_item_url,product_title)
      VALUES (?,?,?,?,'CNY',?,?,?,?,'published',1,?,?)`).run(siteId,sourceId,offer.plan,offer.cnyMinor,offer.period,offer.region,
      observationNotes(offer.notes),observedAt,reportedItem,offer.productTitle||null);
  }
  if (!existing || changed.length || titles || linked || aliasAdded) {
    db.prepare("UPDATE sites SET updated_at=max(updated_at,?) WHERE id=?").run(observedAt,siteId);
    audit(db,actor,existing?"storefront_update":"storefront_publish","sites",siteId,null,
      {publication:"published",name,website:canonical,links:[...links.keys()],source:source.url,discovery,quotes:changed.length,titles});
  }
  return {siteId,slug,category:existing?.category_slug??category,created:!existing,prices:changed.length,linked,titles};
}

export function importStorefronts(db:DatabaseSync,rows:StorefrontObservation[],actor="storefront-batch") {
  if (!Array.isArray(rows) || rows.length>5000) throw new Error("每批最多处理 5,000 家店铺。");
  return rows.map(row=>{
    try {
      const outcome = transaction(db,()=>writeStorefrontObservation(db,row,actor));
      return {website:row.website,name:row.name,...outcome};
    } catch (error) {
      return {website:row?.website,name:row?.name,error:error instanceof Error?error.message:"写入失败"};
    }
  });
}
