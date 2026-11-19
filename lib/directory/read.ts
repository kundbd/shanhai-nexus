import type { SQLInputValue } from "node:sqlite";
import { editorialVisibility, siteVisibility, type ContentVisibility } from "../geo/visibility";
import { all, directory, one } from "./db";
import type { Category, Claim, Editorial, Incident, Price, Site, Source, Status } from "./types";
import { categoryGroups,isRetiredCategory } from "./taxonomy";
import { catalogStartingPrices,priceRecordedTime,storefrontTierNeedsReview } from "./price-board";
import { publicPriceEvidence,storefrontPriceEvidence } from "./public-quote-policy";
import { directoryCategoryTerms,directorySearch } from "./search-query";

const storefrontPrice=storefrontPriceEvidence;
const storefrontEvidence = `FROM price_records p JOIN sources src ON src.id=p.source_id AND src.verified=1
  WHERE p.site_id=s.id AND p.publication='published' AND ${storefrontPrice}`;
const productAdmission = `EXISTS(SELECT 1 ${storefrontEvidence})`;
const pricingEvidence=`EXISTS(SELECT 1 FROM price_records p JOIN sources src ON src.id=p.source_id
  WHERE p.site_id=s.id AND p.publication='published' AND ${publicPriceEvidence})`;
const siteSelect = `SELECT s.*, a.digest avatar_digest, coalesce(d.domain,
  (SELECT sf.host FROM merchant_storefronts sf WHERE sf.site_id=s.id ORDER BY (sf.url=s.website) DESC,sf.storefront_key LIMIT 1)) domain,
  (d.site_id IS NULL) hosted_storefront, c.label category_label,
  ${pricingEvidence} has_public_prices,
  (SELECT max(p.recorded_at) ${storefrontEvidence}) product_observed_at,
  (SELECT count(*) FROM user_reviews ur WHERE ur.site_id=s.id AND ur.thread_id IS NULL AND ur.moderation='accepted') review_count
  FROM sites s LEFT JOIN site_domains d ON d.site_id=s.id AND d.kind='primary'
  LEFT JOIN merchant_avatars a ON a.site_id=s.id AND a.website=s.website
  INNER JOIN categories c ON c.slug=s.category_slug`;

export const listCategories = (db = directory()) =>
  all<Category>(db, "SELECT * FROM categories ORDER BY parent_slug IS NOT NULL, parent_slug, position, label");
export const listPublicCategories = (db = directory(), visibility?: ContentVisibility) =>
  listCategories(db).filter(({slug}) => visibility ? visibility.categoryAllowed(slug) : !isRetiredCategory(slug));
export const getCategory = (slug: string, db = directory(), visibility?: ContentVisibility) =>
  (visibility ? visibility.categoryAllowed(slug) : !isRetiredCategory(slug))
    ? one<Category>(db, "SELECT * FROM categories WHERE slug=?", slug) : undefined;

export function getSite(slug: string, db = directory(), visibility?: ContentVisibility) {
  const region = visibility ? siteVisibility(visibility) : {clause:"1",bindings:[]};
  return one<Site>(db, `${siteSelect} WHERE s.slug=? AND s.publication='published' AND ${region.clause}`, slug.slice(0,90), ...region.bindings);
}

export function getSiteById(id:number, db=directory(), visibility?: ContentVisibility) {
  const region = visibility ? siteVisibility(visibility) : {clause:"1",bindings:[]};
  return one<Site>(db,`${siteSelect} WHERE s.id=? AND s.publication='published' AND ${region.clause}`,id,...region.bindings);
}

export function getDomains(site: number, db = directory()) {
  return all<{ domain: string; kind: string }>(db, "SELECT domain,kind FROM site_domains WHERE site_id=? ORDER BY kind,domain", site);
}

export function getStorefronts(site: number, db = directory()) {
  return all<{url:string;host:string}>(db,"SELECT url,host FROM merchant_storefronts WHERE site_id=? ORDER BY storefront_key",site);
}

export function merchantTags(site:number,db=directory()) {
  return all<{tag:string}>(db,"SELECT tag FROM merchant_site_tags WHERE site_id=? ORDER BY tag",site).map(row=>row.tag);
}

export function publicSources(site: number, db = directory()) {
  return all<Source>(db, "SELECT * FROM sources WHERE site_id=? ORDER BY verified DESC,accessed_at DESC,id DESC", site);
}

export function publicPrices(site: number, db = directory()) {
  return all<Price>(db, `SELECT p.*, src.url source_url, src.title source_title FROM price_records p
    JOIN sources src ON src.id=p.source_id JOIN sites s ON s.id=p.site_id
    WHERE p.site_id=? AND p.publication='published' AND s.publication='published'
    AND ${publicPriceEvidence}
    ORDER BY ${priceRecordedTime("p.recorded_at")} DESC, p.id DESC`, site);
}

type PriceIdentity=Pick<Price,"reported_item_url"|"plan"|"currency"|"region"|"period"|"storefront_observed"|"source_url">;
export const priceIdentity=(price:PriceIdentity)=>price.reported_item_url||
  JSON.stringify([price.plan,price.currency,price.region,price.period,price.storefront_observed?price.source_url:undefined]);

export function latestPrices(prices: readonly Price[]) {
  const current = new Map<string, Price>();
  for (const price of prices) {
    const key = priceIdentity(price);
    if (!current.has(key)) current.set(key, price);
  }
  return [...current.values()];
}

export function publicIncidents(site?: number, limit = 100, db = directory(), visibility?: ContentVisibility) {
  const region = siteVisibility(visibility);
  return all<Incident>(db, `SELECT i.*, src.url source_url, s.name site_name,s.slug site_slug FROM incidents i
    JOIN sources src ON src.id=i.source_id AND src.verified=1 JOIN sites s ON s.id=i.site_id AND s.publication='published'
    WHERE i.publication='published' AND (? IS NULL OR i.site_id=?) AND ${region.clause}
    ORDER BY i.occurred_at DESC, i.id DESC LIMIT ?`, site ?? null, site ?? null, ...region.bindings, limit);
}

export function publicEditorial(slug: string, db = directory(), visibility?: ContentVisibility) {
  const region = editorialVisibility(visibility);
  return one<Editorial>(db, `SELECT e.* FROM editorials e WHERE e.publication='published' AND ${region.clause} AND e.slug=?`, ...region.bindings, slug);
}

export function publicEditorials(site?: number, limit = 100, db = directory(), visibility?: ContentVisibility) {
  const region = editorialVisibility(visibility);
  return all<Editorial>(db, `SELECT e.* FROM editorials e WHERE e.publication='published' AND ${region.clause}
    AND (? IS NULL OR e.site_id=?) ORDER BY updated_at DESC,id ASC LIMIT ?`, ...region.bindings, site ?? null, site ?? null, limit);
}
export function publicClaims(editorial: number, db = directory()) {
  return all<Claim & { url: string | null; source_title: string | null }>(db, `SELECT c.*,s.url, s.title source_title FROM editorial_claims c
    LEFT JOIN sources s ON c.source_id=s.id AND s.verified=1 WHERE editorial_id=? AND (c.nature='pending' OR s.id IS NOT NULL) ORDER BY c.id`, editorial);
}

export type DirectoryFilter = { q?: string; category?: string; group?:string; status?: string; reachability?:string; lifecycle?:string; operator?:string; official?:string;
  sort?: string; page?: number; size?: number; showAll?: boolean; includeStartingPrices?:boolean; visibility?: ContentVisibility };

function filters(input: DirectoryFilter) {
  const region = siteVisibility(input.visibility);
  const clauses = ["s.publication='published'",region.clause];
  const params: SQLInputValue[] = [...region.bindings];
  if (input.category) {
    clauses.push(`s.category_slug IN (WITH RECURSIVE descendants(slug) AS
      (SELECT slug FROM categories WHERE slug=? UNION SELECT c.slug FROM categories c JOIN descendants p ON c.parent_slug=p.slug)
      SELECT slug FROM descendants)`);
    params.push(input.category);
  }
  if (input.group && Object.hasOwn(categoryGroups,input.group)) {
    const group = categoryGroups[input.group as keyof typeof categoryGroups];
    clauses.push(`s.category_slug IN (${group.map(()=>"?").join(",")})`);
    params.push(...group);
  }
  if (["listed", "verified", "tested"].includes(input.status ?? "")) {
    clauses.push("s.status=?");
    params.push(input.status as Status);
  }
  if (input.status==="product-observed") clauses.push(productAdmission);
  if (input.status==="priced") clauses.push(pricingEvidence);
  if (input.status==="unpriced") clauses.push(`NOT ${pricingEvidence}`);
  if (["reachable","restricted","unreachable","skipped","inconclusive","unchecked"].includes(input.reachability ?? "")) {
    clauses.push("s.reachability=?"); params.push(input.reachability!);
  }
  if (input.lifecycle === "current") clauses.push("s.lifecycle<>'closed'");
  if (input.lifecycle === "closed") clauses.push("s.lifecycle='closed'");
  if (input.official==="verified") clauses.push("s.status<>'listed' AND EXISTS (SELECT 1 FROM sources v WHERE v.site_id=s.id AND v.kind='official' AND v.verified=1)");
  if (input.official==="pending") clauses.push("(s.status='listed' OR NOT EXISTS (SELECT 1 FROM sources v WHERE v.site_id=s.id AND v.kind='official' AND v.verified=1))");
  if (["official","third_party","unknown"].includes(input.operator ?? "")) {
    clauses.push("s.operator_kind=?"); params.push(input.operator!);
  }
  return { where: clauses.join(" AND "), params };
}

export type SitePriceMatch=Pick<Price,"plan"|"product_title">&{label:string;storefront:boolean};
type SearchPrice=PriceIdentity&Pick<Price,"site_id"|"product_title"|"amount_minor">&{ category_label:string;category_slug:string };
const subscriptionCategories=new Set(["ai-card","ai-topup","ai-platforms","ai-subscriptions"]);

function matchingPublicPrices(db:ReturnType<typeof directory>,where:string,params:SQLInputValue[],search:ReturnType<typeof directorySearch>) {
  const matches=new Map<number,SitePriceMatch&{score:number}>();
  if (!search.searchable) return matches;
  const rows=db.prepare(`SELECT p.site_id,p.plan,p.product_title,p.amount_minor,p.currency,p.region,p.period,p.storefront_observed,
    p.reported_item_url,src.url source_url,c.label category_label,c.slug category_slug
    FROM sites s JOIN price_records p ON p.site_id=s.id JOIN sources src ON src.id=p.source_id
    JOIN categories c ON c.slug=s.category_slug
    WHERE ${where} AND s.lifecycle<>'closed' AND p.publication='published' AND ${publicPriceEvidence}
    ORDER BY p.site_id,${priceRecordedTime("p.recorded_at")} DESC,p.id DESC`).iterate(...params) as Iterable<SearchPrice>;
  const scores=new Map<string,number>();
  function scoreText(text:string,quote:SearchPrice) {
    const aiSubscription=subscriptionCategories.has(quote.category_slug);
    const cacheKey=search.hasQuoteFilter?JSON.stringify([text,quote.period,quote.currency,aiSubscription]):text;
    const cached=scores.get(cacheKey);
    if(cached!==undefined)return cached;
    const score=search.quoteScore(text,quote,aiSubscription);
    scores.set(cacheKey,score);
    return score;
  }
  const seen=new Set<string>();
  let siteId:number|undefined;
  for (const row of rows) {
    if (row.site_id!==siteId) {siteId=row.site_id;seen.clear();}
    const identity=priceIdentity(row);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const title=row.product_title?.trim();
    const titleScore=Math.max(title?scoreText(title,row)*9:0,
      search.containsUrl&&row.reported_item_url?scoreText(row.reported_item_url,row)*10:0);
    const planScore=scoreText(row.plan,row)*8;
    const usablePlanScore=planScore>titleScore&&storefrontTierNeedsReview(row)?0:planScore;
    const categoryScore=search.hasQuoteFilter?scoreText(row.category_label,row)*4:0;
    const score=Math.max(titleScore,usablePlanScore,categoryScore);
    if (score>(matches.get(row.site_id)?.score??0)) {
      matches.set(row.site_id,{label:title&&titleScore>=usablePlanScore?title:row.plan,plan:row.plan,product_title:row.product_title,storefront:row.storefront_observed===1,score});
    }
  }
  return matches;
}

export function listSites(input: DirectoryFilter = {}, db = directory()) {
  const { where, params } = filters(input);
  const order = input.sort === "name" ? "s.name COLLATE NOCASE, s.id" : "s.updated_at DESC, s.id DESC";
  const priceDirection=input.sort==="price-asc"?1:input.sort==="price-desc"?-1:0;
  const size = Number.isInteger(input.size) ? Math.min(100, Math.max(1, input.size!)) : 12;
  const requestPage = Number.isInteger(input.page) ? Math.max(1,input.page!) : 1;
  function pageRows(rows:Site[],page:number,paginate:boolean) {
    const rankedPrices=priceDirection?catalogStartingPrices(db,rows.map(({id})=>id),undefined,input.visibility):undefined;
    if (rankedPrices) rows.sort((a,b)=>{
      const first=rankedPrices.get(a.id);
      const second=rankedPrices.get(b.id);
      const left=first?.referenceAt?undefined:first?.cnyAmount;
      const right=second?.referenceAt?undefined:second?.cnyAmount;
      if (left===undefined||right===undefined) return Number(left===undefined)-Number(right===undefined);
      return priceDirection*(left-right);
    });
    const visible=paginate&&!input.showAll?rows.slice((page-1)*size,page*size):rows;
    const startingPrices=rankedPrices??(input.includeStartingPrices?catalogStartingPrices(db,visible.map(({id})=>id),undefined,input.visibility):undefined);
    return {rows:visible,startingPrices};
  }
  if (!input.q?.trim()) {
    const total = one<{ n: number }>(db, `SELECT count(*) n FROM sites s WHERE ${where}`, ...params)!.n;
    const page = Math.min(requestPage, Math.max(1, Math.ceil(total / size)));
    const limit=!input.showAll&&!priceDirection;
    const rows = all<Site>(db, `${siteSelect} WHERE ${where} ORDER BY ${order}${limit ? " LIMIT ? OFFSET ?" : ""}`,
      ...params, ...(limit ? [size, (page - 1) * size] : []));
    return { ...pageRows(rows,page,Boolean(priceDirection)), total, page, size, priceMatches:new Map<number,SitePriceMatch>() };
  }
  const search=directorySearch(input.q);
  const priceMatches=matchingPublicPrices(db,where,params,search);
  const hiddenEditorials = input.visibility?.hiddenEditorials ?? [];
  const candidates = all<Site & { extra_domains: string | null; shop_urls: string | null; editorials: string; parent_label: string; parent_slug: string|null; service_tags:string }>(db, `SELECT base.*,
    (SELECT group_concat(domain, ' ') FROM site_domains sd WHERE sd.site_id=base.id) extra_domains,
    (SELECT group_concat(url, ' ') FROM merchant_storefronts sf WHERE sf.site_id=base.id) shop_urls,
    COALESCE((SELECT group_concat(tag, ' ') FROM merchant_site_tags mt WHERE mt.site_id=base.id),'') service_tags,
    COALESCE((SELECT group_concat(e.title || ' ' || e.summary || ' ' || e.body || ' ' || COALESCE(
      (SELECT group_concat(ec.statement,' ') FROM editorial_claims ec JOIN sources src ON src.id=ec.source_id AND src.verified=1 WHERE ec.editorial_id=e.id), ''))
      FROM editorials e WHERE e.site_id=base.id AND e.publication='published'
      ${hiddenEditorials.length ? "AND e.slug NOT IN (SELECT value FROM json_each(?))" : ""}), '') editorials,
    COALESCE(p.label,'') parent_label,p.slug parent_slug
    FROM (${siteSelect} WHERE ${where}) base
    JOIN categories category ON category.slug=base.category_slug
    LEFT JOIN categories p ON p.slug=category.parent_slug
    ORDER BY ${order.replaceAll("s.","base.")}`, ...(hiddenEditorials.length ? [JSON.stringify(hiddenEditorials)] : []), ...params);
  const matches = candidates.map(({ extra_domains, shop_urls, editorials, parent_label, parent_slug, service_tags, ...site }) => {
    const quoteScore=priceMatches.get(site.id)?.score??0;
    if (search.hasQuoteFilter) return {site,score:search.literalMatch(site.name)?168:quoteScore};
    const tags=[site.category_label,parent_label,service_tags];
    const description=site.status==="listed"?"":site.products??"";
    const categoryScore=[site.category_slug,parent_slug??""]
      .some((category)=>search.matchesCategory(directoryCategoryTerms(category)))?84:0;
    const profileScore=search.score([
      { text: site.name, weight: 14 }, { text: site.domain ?? "", weight: 13 }, { text: site.website, weight: 14 },
      ...(extra_domains ?? "").split(" ").map((text) => ({ text, weight: 11 })),
      ...(shop_urls ?? "").split(" ").map((text) => ({ text, weight: 13 })),
      ...(JSON.parse(site.aliases) as string[]).map((text) => ({ text, weight: 12 })),
      ...tags.map((text)=>({text,weight:7})),
      { text: site.status==="listed"?"":Object.values(JSON.parse(site.merchant_details) as Record<string,string>).join(" "), weight: 4 },
      { text: description, weight: 7 },
      { text: site.summary, weight: 5 }, { text: editorials, weight: 5 },
      { text: search.structured?"":[site.name,...tags,description,site.summary].join(" "), weight: 3 },
    ]);
    return {site,score:Math.max(quoteScore,categoryScore,profileScore)};
  }).filter(({ score }) => score > 0);
  if (!input.sort || input.sort === "relevance") matches.sort((a, b) => b.score - a.score);
  const page = Math.min(requestPage, Math.max(1, Math.ceil(matches.length / size)));
  return { ...pageRows(matches.map(({ site })=>site),page,true), total: matches.length, page, size, priceMatches };
}

export function countPublicSites(input:DirectoryFilter,db=directory()) {
  const {where,params}=filters(input);
  return one<{n:number}>(db,`SELECT count(*) n FROM sites s WHERE ${where}`,...params)!.n;
}

export function countPublicAiRetailProducts(db=directory(),visibility?: ContentVisibility) {
  const {where,params}=filters({group:"ai-retail",lifecycle:"current",visibility});
  return one<{n:number}>(db,`SELECT count(*) n FROM (
    SELECT DISTINCT s.id,p.reported_item_url,
      CASE WHEN p.reported_item_url IS NULL THEN src.url END,
      CASE WHEN p.reported_item_url IS NULL THEN p.plan END,
      CASE WHEN p.reported_item_url IS NULL THEN p.period END,
      CASE WHEN p.reported_item_url IS NULL THEN p.region END
    FROM sites s JOIN price_records p ON p.site_id=s.id
    JOIN sources src ON src.id=p.source_id AND src.verified=1
    WHERE ${where} AND p.publication='published' AND ${storefrontPrice}
  )`,...params)!.n;
}

export function directoryStats(input:DirectoryFilter,db=directory()) {
  const {where,params}=filters(input);
  return one<{total:number;verified:number;pending:number;observed:number;priced:number;last:string|null}>(db,`SELECT count(*) total,
    count(CASE WHEN s.status<>'listed' THEN 1 END) verified,count(CASE WHEN s.status='listed' THEN 1 END) pending,
    count(CASE WHEN ${productAdmission} THEN 1 END) observed,
    count(CASE WHEN ${pricingEvidence} THEN 1 END) priced,
    max(s.updated_at) last FROM sites s WHERE ${where}`,...params)!;
}


export function publicReviews(site: number, db = directory(), page = 1) {
  return all<{ id:number;score:number|null;body:string;submitted_at:string;evidence_state:string;reply_count:number }>(db,
    `SELECT r.id,r.score,r.body,r.submitted_at,r.evidence_state,
     (SELECT count(*) FROM user_reviews c WHERE c.thread_id=r.id AND c.moderation='accepted') reply_count
     FROM user_reviews r WHERE r.site_id=? AND r.thread_id IS NULL AND r.moderation='accepted' ORDER BY r.submitted_at DESC,r.id DESC LIMIT 20 OFFSET ?`,site,(page-1)*20);
}
