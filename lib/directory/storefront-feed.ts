import type { DatabaseSync } from "node:sqlite";
import { all,one,transaction } from "./db";
import { priceMemoVisibleOffer,visibleAiProduct } from "./storefront-product-evidence";
import { priceMemoProductStorefront } from "./storefront-identity";
import { readPublicPage,type Visit } from "./website-check";

const pointerUrl="https://ai.pricememo.cn/data/latest.json";
const snapshotPattern=/^https:\/\/ai\.pricememo\.cn\/data\/v1\/snapshots\/(\d{1,16})\.json$/;
const publicationAge=2*60*60_000;
export const storefrontFeedAge=6*60*60_000;

type KnownQuote={id:number;site_id:number;reported_item_url:string;plan:string;product_title:string;period:string;recorded_at:string};
type FeedState={run_id:number|null;attempted_at:string;snapshot_url:string|null;published_at:string|null;reviewed_snapshot_url:string|null};
type Observation={quoteId:number;amount:number;at:string};
export type FeedCheck="in_stock"|"out_of_stock"|"stale"|"terms_changed"|"identity_conflict"|"uncertain";

function object(value:unknown) {
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

function recentOffers(db:DatabaseSync,products:unknown[],published:number,clock:number) {
  const byUrl=new Map<string,KnownQuote>();
  const conflicts=new Set<string>();
  const known=all<KnownQuote>(db,`WITH latest AS (
    SELECT p.id,p.site_id,p.reported_item_url,p.plan,p.product_title,p.period,p.recorded_at,
      row_number() OVER (PARTITION BY p.site_id,p.reported_item_url ORDER BY p.recorded_at DESC,p.id DESC) position
      FROM price_records p JOIN sites s ON s.id=p.site_id JOIN sources src ON src.id=p.source_id AND src.site_id=s.id
      WHERE p.publication='published' AND p.currency='CNY' AND p.storefront_observed=1 AND p.reported_item_url IS NOT NULL
        AND p.product_title IS NOT NULL AND s.publication='published' AND s.lifecycle<>'closed'
        AND s.category_slug IN ('ai-topup','ai-card') AND src.verified=1 AND src.kind='media'
        AND src.url GLOB 'https://ai.pricememo.cn/data/v1/snapshots/*.json'
    ) SELECT * FROM latest WHERE position=1`);
  for (const row of known) {
    if (byUrl.has(row.reported_item_url)) conflicts.add(row.reported_item_url);
    byUrl.set(row.reported_item_url,row);
  }
  const shops=new Map(all<{storefront_key:string;site_id:number}>(db,"SELECT storefront_key,site_id FROM merchant_storefronts")
    .map(shop=>[shop.storefront_key,shop.site_id]));
  const observed=new Map<string,Observation>();
  const findings=new Map<string,{outcome:FeedCheck;at:string|null}>();
  const seen=new Map<string,string>();
  for (const item of products) {
    const product=object(item);
    const name=typeof product.display_name==="string"?product.display_name.trim():"";
    if (!Array.isArray(product.offers)) continue;
    const eligibleProduct=visibleAiProduct(product.product_type,name);
    for (const raw of product.offers) {
      const row=object(raw);
      const url=typeof row.source_url==="string"?row.source_url:"";
      const quote=byUrl.get(url);
      if (!quote||conflicts.has(url)) continue;
      if (typeof row.source_platform!=="string"||typeof row.shop_token!=="string") { conflicts.add(url);continue; }
      const storefront=priceMemoProductStorefront(row.source_platform,row.shop_token,url);
      if (!storefront||shops.get(storefront.key)!==quote.site_id) { conflicts.add(url);continue; }
      const signature=JSON.stringify([name,product.product_type,row.stock_status,row.stock_count,row.price,row.currency,row.observed_at,row.original_name,row.delivery_type,row.service_period,row.is_comparable,row.is_trusted_price,row.risk_flags]);
      if (seen.has(url)&&seen.get(url)!==signature) { conflicts.add(url);continue; }
      seen.set(url,signature);
      const lastSeen=typeof row.observed_at==="string"?Date.parse(row.observed_at):NaN;
      const at=Number.isFinite(lastSeen)&&lastSeen<=published?new Date(lastSeen).toISOString():null;
      if (!at||lastSeen<Math.max(published-publicationAge,Date.parse(quote.recorded_at))) {
        findings.set(url,{outcome:at?"stale":"uncertain",at});
        continue;
      }
      const evidence=priceMemoVisibleOffer(name,row,storefront.key.slice(storefront.key.indexOf("/")+1),clock);
      if (!eligibleProduct||evidence&&(evidence.offer.plan!==quote.plan||evidence.offer.period!==quote.period||evidence.offer.productTitle!==quote.product_title)) {
        findings.set(url,{outcome:"terms_changed",at});
      } else if (evidence&&(row.stock_status==="out_of_stock"||row.stock_count===0)) {
        findings.set(url,{outcome:"out_of_stock",at});
      } else if (!evidence||row.stock_status!=="in_stock"||row.is_comparable!==true||row.is_trusted_price!==true||evidence.offer.notes||evidence.offer.cnyMinor<100) {
        findings.set(url,{outcome:"uncertain",at});
      } else {
        findings.set(url,{outcome:"in_stock",at});
        observed.set(url,{quoteId:quote.id,amount:evidence.offer.cnyMinor,at});
      }
    }
  }
  const checks=known.flatMap(quote=>{
    const url=quote.reported_item_url;
    const result=conflicts.has(url)?{outcome:"identity_conflict" as const,at:null}:findings.get(url);
    return result?[{quoteId:quote.id,...result}]:[];
  });
  const offers=[...observed].filter(([url])=>!conflicts.has(url)).map(([,quote])=>quote);
  return {checks,offers};
}

export async function refreshStorefrontFeed(db:DatabaseSync,visit:Visit,clock=Date.now,runId:number|null=null) {
  const now=clock();
  const attemptedAt=new Date(now).toISOString();
  const previous=transaction(db,()=>{
    const state=one<FeedState>(db,"SELECT * FROM storefront_feed_state WHERE id=1");
    if (state&&(now-Date.parse(state.attempted_at)<60_000||(runId!==null&&state.run_id===runId))) return;
    db.prepare(`INSERT INTO storefront_feed_state(id,run_id,attempted_at,state) VALUES(1,?,?,'reading')
      ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,attempted_at=excluded.attempted_at,state='reading',reason=''`).run(runId,attemptedAt);
    return state??null;
  });
  if (previous===undefined) return {state:"skipped"};
  try {
    const pointerPage=await readPublicPage(pointerUrl,visit,32_000,16_000,0);
    if (pointerPage.truncated||pointerPage.url!==pointerUrl) throw new Error("公开快照索引内容无效");
    const pointer=object(JSON.parse(pointerPage.body));
    const published=typeof pointer.published_at==="string"?Date.parse(pointer.published_at):NaN;
    const url=typeof pointer.snapshot_url==="string"?pointer.snapshot_url:"";
    const snapshotId=snapshotPattern.exec(url)?.[1];
    if (!snapshotId||String(pointer.snapshot_id)!==snapshotId||pointer.schema_version!=="price-radar.v1"||
      pointer.stale!==false||!(published<=now&&now-published<=publicationAge)) throw new Error("公开快照已过期或不符合接口约定");
    if (previous?.published_at&&published<Date.parse(previous.published_at)) throw new Error("公开快照时间回退");
    if (previous?.snapshot_url===url&&previous.reviewed_snapshot_url===url) {
      db.prepare("UPDATE storefront_feed_state SET state='unchanged' WHERE attempted_at=?").run(attemptedAt);
      return {state:"unchanged"};
    }
    const body=await readPublicPage(url,visit,30_000_000,42_000,0);
    if (body.truncated||body.url!==url) throw new Error("公开快照地址或大小超出接口约定");
    const data=object(JSON.parse(body.body));
    if (data.schema_version!=="price-radar.v1"||String(data.snapshot_id)!==snapshotId||data.snapshot_url!==url||
      data.published_at!==pointer.published_at||data.stale!==false||!Array.isArray(data.products)) throw new Error("公开快照内容与索引不一致");
    return transaction(db,()=>{
      if (!one(db,"SELECT 1 FROM storefront_feed_state WHERE attempted_at=? AND state='reading'",attemptedAt)) return {state:"skipped"};
      const {checks,offers}=recentOffers(db,data.products as unknown[],published,now);
      db.exec("DELETE FROM storefront_feed_quotes; DELETE FROM storefront_feed_checks");
      const save=db.prepare("INSERT INTO storefront_feed_quotes(quote_id,amount_minor,observed_at,snapshot_url) VALUES(?,?,?,?)");
      for (const quote of offers) save.run(quote.quoteId,quote.amount,quote.at,url);
      const check=db.prepare("INSERT INTO storefront_feed_checks(quote_id,outcome,observed_at) VALUES(?,?,?)");
      for (const row of checks) check.run(row.quoteId,row.outcome,row.at);
      db.prepare("UPDATE storefront_feed_state SET state='updated',snapshot_url=?,published_at=?,reviewed_snapshot_url=? WHERE attempted_at=?")
        .run(url,new Date(published).toISOString(),url,attemptedAt);
      return {state:"updated",quotes:offers.length,snapshot:url,publishedAt:new Date(published).toISOString()};
    });
  } catch (cause) {
    const reason=cause instanceof Error?cause.message.slice(0,160):"公开快照读取失败";
    db.prepare("UPDATE storefront_feed_state SET state='unavailable',reason=? WHERE attempted_at=?").run(reason,attemptedAt);
    return {state:"unavailable",reason};
  }
}
