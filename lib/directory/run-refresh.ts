import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { one,transaction } from "./db";
import { searchDeepSeek } from "./deepseek-search";
import { readDujiaoObservation } from "./dujiao-storefront";
import { exchangeRateFeed,saveExchangeRates } from "./exchange-rates";
import { merchantNameKey } from "./merchant-evidence";
import { assessAutomatedAdmission } from "./merchant-lead-page";
import { limitedBacklogVisit } from "./merchant-lead-review";
import { parseProxy } from "./network-transport";
import { refreshablePublicQuotes,type PublishedQuote } from "./price-board";
import { collectRefreshLeads,pendingRefreshLeads,privateRefreshPath,processRefreshLead,readShopObservation,refreshAccessRule,refreshFailure,saveShopObservation } from "./refresh-discovery";
import { claimRefresh,directoryRefreshStatus,finishRefreshBatch,ownsRefresh,pendingRefreshTargets,renewRefresh,type RefreshLease,type RefreshTarget } from "./refresh-state";
import { structuredPublicQuotes,verifiedQuoteAmount } from "./refresh-quotes";
import { invalidateStorefrontAvailability } from "./storefront-availability";
import { refreshStorefrontFeed } from "./storefront-feed";
import { storefrontIdentity } from "./storefront-identity";
import type { StorefrontObservation } from "./storefront-import";
import { websiteUrl } from "./validation";
import { checkWebsite,readPublicPage,websiteVisit,type Visit } from "./website-check";
import { audit } from "./write";

const actor="directory-refresh";
type RunnerOptions={batch?:number;clock?:()=>number;visit?:Visit;rateVisit?:Visit;search?:typeof searchDeepSeek;signal?:AbortSignal};
type PriceFact={quote:PublishedQuote;amount:number;source:string};
type Finding={state:Awaited<ReturnType<typeof checkWebsite>>["state"]|"needs_evidence";reason:string;link?:string;prices?:PriceFact[];shop?:StorefrontObservation};
type Shop={id:number;name:string;website:string;category_slug:StorefrontObservation["category"]};

function publicPriceUrl(value:string) {
  try {
    const parsed=websiteUrl(value);
    const url=new URL(parsed.url);
    if (url.search||privateRefreshPath.test(url.pathname)) return;
    return {...parsed,url:url.href};
  } catch { return undefined; }
}

function guarded(request:Visit,blocked:(url:string)=>boolean,stop?:AbortSignal):Visit {
  const restricted=new Set<string>();
  return async (url,signal,max)=>{
    const domain=websiteUrl(url.href).registrable;
    if (privateRefreshPath.test(url.pathname)) throw new Error("目标为登录或付款页面");
    if (blocked(url.href)||restricted.has(domain)) throw new Error("来源限制，跳过本轮访问");
    const page=await request(url,stop?AbortSignal.any([signal,stop]):signal,max);
    if ([401,403,407,429,451].includes(page.status)||/<title>\s*(?:just a moment|attention required|access denied|captcha)/i.test(page.body)) restricted.add(domain);
    return page;
  };
}

function reason(error:unknown) {
  return (error instanceof Error?error.message:"请求未完成").slice(0,180);
}

async function refreshExchange(db:DatabaseSync,lease:RefreshLease,clock:()=>number,visit:Visit) {
  if (lease.run.rate_state!=="pending") return;
  let xml:string;
  try {
    const page=await readPublicPage(exchangeRateFeed,visit,64_000,26_000,1);
    if (page.truncated) throw new Error("参考汇率文件超出读取上限");
    xml=page.body;
    if (!ownsRefresh(db,lease)) return;
    const day=saveExchangeRates(db,xml,new Date(clock()).toISOString());
    db.prepare("UPDATE directory_refresh_runs SET rate_state='ok',rate_day=? WHERE id=? AND token=?").run(day,lease.run.id,lease.token);
  } catch (error) {
    db.prepare("UPDATE directory_refresh_runs SET rate_state='failed',rate_error=? WHERE id=? AND token=?").run(reason(error),lease.run.id,lease.token);
  }
}

function currentShop(db:DatabaseSync,id:number) {
  return one<Shop>(db,`SELECT id,name,website,category_slug FROM sites
    WHERE id=? AND publication='published' AND lifecycle<>'closed' AND category_slug IN ('ai-topup','ai-card')`,id);
}

function sameShop(site:Shop,pageUrl:string) {
  const first=storefrontIdentity(site.website);
  if (first) return storefrontIdentity(pageUrl)?.key===first.key;
  return websiteUrl(site.website).registrable===websiteUrl(pageUrl).registrable;
}

async function checkPrices(db:DatabaseSync,target:{site_id:number;url:string},visit:Visit,clock:()=>number):Promise<Finding> {
  const approved=publicPriceUrl(target.url);
  if (!approved) return {state:"skipped",reason:"报价链接不是可自动核查的公开地址"};
  const quotes=refreshablePublicQuotes(db,target.site_id).filter(row=>row.source_url===target.url);
  if (!quotes.length) return {state:"skipped",reason:"原有报价已下架或来源已修改"};
  const prices:PriceFact[]=[];
  const page=await readPublicPage(approved.url,visit,1_000_000,20_000,1);
  const stamp=new Date(clock()).toISOString();
  let shop:StorefrontObservation|undefined;
  if (!page.truncated&&/html/i.test(page.contentType)&&publicPriceUrl(page.url)) {
    const site=quotes.some(row=>row.storefront_observed)?currentShop(db,target.site_id):undefined;
    if (site&&sameShop(site,page.url)&&approved.url===page.url) {
      const observed=readShopObservation(page,stamp,site.name,site.category_slug)??await readDujiaoObservation(page,site,stamp,visit);
      if (observed&&merchantNameKey(observed.name)===merchantNameKey(site.name)) shop=observed;
    }
    const structured=structuredPublicQuotes(page.body,page.url,stamp);
    for (const quote of quotes) {
      if (quote.storefront_observed) continue;
      const amount=verifiedQuoteAmount(page.body,page.url,quote,stamp,structured);
      if (amount!==undefined) prices.push({quote,amount,source:page.url});
    }
  }
  if (prices.length||shop) return {state:"reachable",reason:"取得商品人民币标价或同套餐、同币种、同周期报价",prices,shop,link:page.url};
  return {state:"needs_evidence",reason:"公开页未提供可确认的原套餐与计费条件，保留已有报价",link:page.url};
}

async function checkEntry(db:DatabaseSync,run:number,target:RefreshTarget,visit:Visit,clock:()=>number):Promise<Finding> {
  const site=currentShop(db,target.site_id!);
  if (!site) {
    const result=await checkWebsite(target.url,visit);
    const state=/登录或付款|来源限制/.test(result.reason)?"restricted":result.state;
    return {state,reason:result.reason,link:result.finalUrl};
  }
  const page=await readPublicPage(target.url,visit,720_000,18_000,1);
  if (page.truncated||!/html/i.test(page.contentType)||!sameShop(site,page.url)) return {state:"inconclusive",reason:"页面未提供该店铺公开资料",link:page.url};
  const assessment=assessAutomatedAdmission("ai-retail",page);
  const stamp=new Date(clock()).toISOString();
  const priceScheduled=(url:string)=>one(db,"SELECT 1 FROM directory_refresh_targets WHERE run_id=? AND site_id=? AND kind='price' AND url=?",
    run,site.id,url);
  const observation=(candidate:typeof page)=>{
    if (!sameShop(site,candidate.url)||priceScheduled(candidate.url)) return;
    const source=readShopObservation(candidate,stamp,site.name,site.category_slug);
    return source&&merchantNameKey(source.name)===merchantNameKey(site.name)?source:undefined;
  };
  let shop=priceScheduled(page.url)?undefined:await readDujiaoObservation(page,site,stamp,visit);
  if (!shop&&assessment.outcome==="merchant"&&assessment.basis==="retail"&&!assessment.checkout) {
    shop=observation(page);
    if (!shop&&assessment.detail&&sameShop(site,assessment.detail)&&!priceScheduled(assessment.detail)) {
      try { shop=observation(await readPublicPage(assessment.detail,visit,720_000,14_000,0)); }
      catch { /* A failed product page does not change the homepage reachability or historical prices. */ }
    }
  }
  return {state:"reachable",reason:"公开主页可访问",link:page.url,shop};
}

function applyPrices(db:DatabaseSync,facts:PriceFact[],stamp:string) {
  if (!facts.length) return {verified:0,changed:0};
  const current=new Map(refreshablePublicQuotes(db,facts[0].quote.site_id).map(row=>[row.id,row]));
  let verified=0,changed=0;
  for (const {quote,amount,source} of facts) {
    const live=current.get(quote.id);
    if (!live||live.amount_minor!==quote.amount_minor||live.recorded_at!==quote.recorded_at||live.source_id!==quote.source_id||
      live.plan!==quote.plan||live.currency!==quote.currency||live.period!==quote.period||live.region!==quote.region||live.amount_scale!==quote.amount_scale) continue;
    verified++;
    if (amount===quote.amount_minor) continue;
    const excerpt=`${quote.plan} · ${quote.currency} ${quote.amount_scale==null?"最小货币单位":`精度 ${quote.amount_scale}`} ${amount} · ${quote.period} · ${quote.region}`;
    db.prepare(`INSERT OR IGNORE INTO sources(site_id,title,url,accessed_at,kind,verified,excerpt,digest)
      VALUES (?,'商家公开报价',?,?,'official',1,?,?)`).run(quote.site_id,source,stamp,excerpt,createHash("sha256").update(excerpt).digest("hex"));
    const owner=one<{id:number}>(db,"SELECT id FROM sources WHERE site_id=? AND url=? AND accessed_at=?",quote.site_id,source,stamp)!;
    const id=db.prepare(`INSERT INTO price_records(site_id,source_id,plan,amount_minor,amount_scale,currency,period,region,notes,recorded_at,publication)
      VALUES (?,?,?,?,?,?,?,?,'官网定时核对',?,'published')`)
      .run(quote.site_id,owner.id,quote.plan,amount,quote.amount_scale??null,quote.currency,quote.period,quote.region,stamp).lastInsertRowid;
    db.prepare("UPDATE sites SET updated_at=max(updated_at,?) WHERE id=?").run(stamp,quote.site_id);
    audit(db,actor,"verified_price_change","price_records",Number(id),{id:quote.id,amount:quote.amount_minor},{amount,source,recorded_at:stamp});
    changed++;
  }
  return {verified,changed};
}

function applyStorefrontFinding(db:DatabaseSync,target:Pick<RefreshTarget,"site_id"|"url">,result:Finding,stamp:string) {
  if (target.site_id===null) return 0;
  if (result.shop&&currentShop(db,target.site_id)) return saveShopObservation(db,result.shop,target.site_id).prices;
  const missing=/^公开页面返回 HTTP (?:404|410)$/.test(result.reason);
  invalidateStorefrontAvailability(db,target.site_id,target.url,stamp,missing?"unavailable":"unconfirmed");
  return 0;
}

function recordFinding(db:DatabaseSync,lease:RefreshLease,target:RefreshTarget,result:Finding,stamp:string) {
  transaction(db,()=>{
    if (!ownsRefresh(db,lease)) return;
    const prices=applyPrices(db,result.prices??[],stamp);
    if (result.shop||target.kind==="price") {
      prices.changed+=applyStorefrontFinding(db,target,result,stamp);
      prices.verified+=result.shop?.offers.length??0;
    }
    db.prepare(`UPDATE directory_refresh_targets SET checked_at=?,result=?,reason=?,evidence_url=?,quotes_checked=?,quotes_changed=? WHERE id=?`)
      .run(stamp,result.state,result.reason,result.link??null,prices.verified,prices.changed,target.id);
    if (target.kind==="site"&&result.state!=="skipped") db.prepare(`UPDATE sites SET checked_at=?,reachability=? WHERE id=? AND website=?
      AND publication='published' AND lifecycle<>'closed' AND (checked_at IS NULL OR checked_at<=?)`).run(stamp,result.state,target.site_id,target.url,stamp);
  });
}

export async function checkStorefrontQuotes(db:DatabaseSync,limit:number,plan:string,options:Pick<RunnerOptions,"visit"|"clock"|"signal">&{sourceUrls?:ReadonlySet<string>}={}) {
  const {clock=Date.now,signal,sourceUrls}=options;
  const blocked=refreshAccessRule(db);
  const visit=guarded(options.visit??limitedBacklogVisit(websiteVisit(parseProxy(process.env.MERCHANT_PROXY)),4,1200),blocked,signal);
  const sources=new Map<string,PublishedQuote>();
  const query=plan.toLowerCase();
  for (const quote of refreshablePublicQuotes(db).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at))) {
    if (!quote.storefront_observed||!quote.plan.toLowerCase().includes(query)||!publicPriceUrl(quote.source_url)||blocked(quote.source_url)) continue;
    if (sourceUrls&&!sourceUrls.has(quote.source_url)) continue;
    const key=JSON.stringify([quote.site_id,quote.source_url]);
    if (!sources.has(key)) sources.set(key,quote);
    if (sources.size>=limit) break;
  }
  const results=[];
  for (const quote of sources.values()) {
    if (signal?.aborted) break;
    const target={site_id:quote.site_id,url:quote.source_url};
    let result:Finding;
    try { result=await checkPrices(db,target,visit,clock); }
    catch (error) { result=refreshFailure(error); }
    if (signal?.aborted) break;
    const stamp=new Date(clock()).toISOString();
    try { transaction(db,()=>applyStorefrontFinding(db,target,result,stamp)); }
    catch (error) {
      if (!result.shop) throw error;
      result={state:"inconclusive",reason:"商品与已有店铺或报价记录冲突，保留上次记录"};
      transaction(db,()=>applyStorefrontFinding(db,target,result,stamp));
    }
    results.push({url:target.url,state:result.state,reason:result.reason,available:result.shop?.offers.filter(offer=>offer.availability==="available").length??0});
  }
  return results;
}

export async function runDirectoryRefresh(db:DatabaseSync,options:RunnerOptions={}) {
  const {clock=Date.now,signal}=options;
  const rate=Number(process.env.MERCHANT_REFRESH_RATE??6);
  const transport=options.visit??websiteVisit(parseProxy(process.env.MERCHANT_PROXY));
  const blocked=refreshAccessRule(db);
  const visit=guarded(options.visit??limitedBacklogVisit(transport,Number.isInteger(rate)&&rate>=1&&rate<=12?rate:6,1200),blocked,signal);
  const rateVisit=options.rateVisit??options.visit??limitedBacklogVisit(transport,1,5000);
  const feedVisit=guarded(options.visit??websiteVisit(parseProxy(process.env.MERCHANT_PROXY),{compressed:true}),blocked,signal);
  const lease=claimRefresh(db,clock());
  if (!lease) return {claimed:false,...directoryRefreshStatus(db)};
  let error="";
  const heartbeat=setInterval(()=>renewRefresh(db,lease,clock()),20_000).unref();
  try {
    await Promise.all([refreshExchange(db,lease,clock,rateVisit),collectRefreshLeads(db,lease,visit,clock,options.search??searchDeepSeek,signal),
      refreshStorefrontFeed(db,feedVisit,clock,lease.run.id)]);
    const batch=Math.max(1,Math.min(250,options.batch??120));
    const leads=pendingRefreshLeads(db,lease.run.id,batch);
    const work=[...leads,...(leads.length<batch?pendingRefreshTargets(db,lease.run.id,batch-leads.length):[])];
    let cursor=0;
    const results=await Promise.allSettled(Array.from({length:Math.min(12,work.length)},async()=>{
      while (!signal?.aborted&&cursor<work.length&&ownsRefresh(db,lease)) {
        const item=work[cursor++];
        if ("identity" in item) {
          await processRefreshLead(db,lease,item,visit,clock,signal);
          continue;
        }
        const target=item;
        let outcome:Finding;
        try {
          if(target.kind==="domain")outcome={state:"skipped",reason:"旧版域名专栏已下线"};
          else if (blocked(target.url)) outcome={state:"skipped",reason:"来源限制，按平台使用范围保留已有资料"};
          else outcome=target.kind==="price"&&target.site_id!==null?await checkPrices(db,{site_id:target.site_id,url:target.url},visit,clock):await checkEntry(db,lease.run.id,target,visit,clock);
        }
        catch (e) { outcome=refreshFailure(e); }
        if (signal?.aborted) return;
        const stamp=new Date(clock()).toISOString();
        try { recordFinding(db,lease,target,outcome,stamp); }
        catch (error) {
          if (!outcome.shop) throw error;
          recordFinding(db,lease,target,{state:"inconclusive",reason:"商品与已有店铺或报价记录冲突，保留上次记录",link:outcome.link},stamp);
        }
      }
    }));
    if (results.some(result=>result.status==="rejected")) error="部分检查暂未保存，将在下一批重试";
  } catch (cause) { error=reason(cause); }
  finally { clearInterval(heartbeat);finishRefreshBatch(db,lease,clock(),error); }
  return {claimed:true,...directoryRefreshStatus(db)};
}
