import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { all,one,transaction } from "./db";
import { searchDeepSeek } from "./deepseek-search";
import { reserveDeepSeekSearch } from "./discovery";
import { exchangeRateFeed,saveExchangeRates } from "./exchange-rates";
import { limitedBacklogVisit } from "./merchant-lead-review";
import { parseProxy } from "./network-transport";
import { currentPublicQuotes,type PublishedQuote } from "./price-board";
import { claimRefresh,directoryRefreshStatus,finishRefreshBatch,ownsRefresh,pendingRefreshTargets,renewRefresh,type RefreshLease,type RefreshTarget } from "./refresh-state";
import { verifiedQuoteAmount } from "./refresh-quotes";
import { websiteUrl } from "./validation";
import { checkWebsite,readPublicPage,websiteVisit,type Visit } from "./website-check";
import { audit } from "./write";

const actor="directory-refresh";
const unitPriceMilli=5;
const privatePaths=/\/(?:login|sign-?in|signup|sign-up|register|account|dashboard|console|auth|checkout|pay|redeem|token)(?:[/.-]|$)/i;
const pricePaths=/\/(?:pricing|prices?|plans?|packages?|vps|subscription|memberships?)(?:[/.-]|$)/i;
type RunnerOptions={batch?:number;clock?:()=>number;visit?:Visit;rateVisit?:Visit;search?:typeof searchDeepSeek;signal?:AbortSignal};
type PriceFact={quote:PublishedQuote;amount:number;source:string};
type Finding={state:Awaited<ReturnType<typeof checkWebsite>>["state"]|"needs_evidence";reason:string;link?:string;prices?:PriceFact[]};

function publicPriceUrl(value:string) {
  try {
    const parsed=websiteUrl(value);
    const url=new URL(parsed.url);
    if (url.search||privatePaths.test(url.pathname)) return;
    return {...parsed,url:url.href};
  } catch { return undefined; }
}

function guarded(request:Visit):Visit {
  return (url,signal,max)=>{
    if (privatePaths.test(url.pathname)) throw new Error("目标为登录或付款页面");
    return request(url,signal,max);
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

async function discoverQuotePages(db:DatabaseSync,lease:RefreshLease,search:typeof searchDeepSeek) {
  const {run,token}=lease;
  if (run.search_state!=="pending") return;
  const allDomains=[...new Set(all<{url:string}>(db,"SELECT url FROM directory_refresh_targets WHERE run_id=? AND kind='price' ORDER BY id",run.id)
    .flatMap(item=>{ const target=publicPriceUrl(item.url);return target?[target.registrable]:[]; }))];
  const offset=allDomains.length?(run.id-1)*3%allDomains.length:0;
  const domains=[...allDomains.slice(offset),...allDomains.slice(0,offset)].slice(0,3);
  let query="pricing plans";
  const scoped:string[]=[];
  for (const domain of domains) {
    const next=`${query}${scoped.length?" OR":""} site:${domain}`;
    if (next.length>128) continue;
    scoped.push(domain);
    query=next;
  }
  if (!scoped.length||(!process.env.DEEPSEEK_API_KEY?.trim()&&search===searchDeepSeek)) {
    db.prepare("UPDATE directory_refresh_runs SET search_state='skipped',search_error=? WHERE id=? AND token=?")
      .run(scoped.length?"未配置 DeepSeek API Key":"没有已核实的报价来源",run.id,token);
    return;
  }
  try {
    const found=await search(query,20,undefined,()=>transaction(db,()=>{
      if (!ownsRefresh(db,lease)) throw new Error("刷新运行权已转移");
      reserveDeepSeekSearch(db);
      db.prepare("UPDATE directory_refresh_runs SET search_state='reserved',search_query=?,search_reserved_milli=? WHERE id=? AND token=?")
        .run(query,unitPriceMilli,run.id,token);
    }));
    const urls=found.urls.flatMap(raw=>{
      const target=publicPriceUrl(raw);
      return target&&scoped.includes(target.registrable)&&pricePaths.test(new URL(target.url).pathname)?[target.url]:[];
    });
    db.prepare("UPDATE directory_refresh_runs SET search_state=?,search_urls=?,search_billable_milli=? WHERE id=? AND token=?")
      .run(found.returned?"done":"empty",JSON.stringify([...new Set(urls)]),found.returned?unitPriceMilli:0,run.id,token);
  } catch (error) {
    const message=reason(error);
    const skipped=/每日请求额度|今日请求额度/.test(message);
    db.prepare("UPDATE directory_refresh_runs SET search_state=?,search_query=?,search_error=? WHERE id=? AND token=?")
      .run(skipped?"skipped":"failed",query,/^DeepSeek Search |^未设置 /.test(message)?message:"DeepSeek 查找报价页未完成",run.id,token);
  }
}

function failedPage(error:unknown):Finding {
  const message=reason(error);
  const state=/robots|访问验证|登录或付款|HTTP (?:401|403|429|451)\b/.test(message)?"restricted":
    /跳往|HTTP \d{3}|上限/.test(message)?"inconclusive":"unreachable";
  return {state,reason:message};
}

async function checkPrices(db:DatabaseSync,target:RefreshTarget,visit:Visit,clock:()=>number,hints:string[]):Promise<Finding> {
  const approved=publicPriceUrl(target.url);
  if (!approved) return {state:"skipped",reason:"报价链接不是可自动核查的公开地址"};
  const quotes=currentPublicQuotes(db).filter(row=>row.source_kind==="official"&&row.site_id===target.site_id&&row.source_url===target.url);
  if (!quotes.length) return {state:"skipped",reason:"原有报价已下架或来源已修改"};
  const related=hints.filter(url=>url!==approved.url&&publicPriceUrl(url)?.registrable===approved.registrable).slice(0,1);
  const prices:PriceFact[]=[];
  let seen=false;
  let failed:Finding|undefined;
  let evidence:string|undefined;
  for (const url of [approved.url,...related]) {
    try {
      const page=await readPublicPage(url,visit,1_000_000,20_000,1);
      seen=true;
      evidence??=page.url;
      if (page.truncated||!/html/i.test(page.contentType)||!publicPriceUrl(page.url)) continue;
      for (const quote of quotes) {
        if (prices.some(fact=>fact.quote.id===quote.id)) continue;
        const amount=verifiedQuoteAmount(page.body,page.url,quote,new Date(clock()).toISOString());
        if (amount!==undefined) prices.push({quote,amount,source:page.url});
      }
      if (prices.length===quotes.length) break;
    } catch (error) {
      failed??=failedPage(error);
      if (failed.state==="restricted") break;
    }
  }
  if (prices.length) return {state:"reachable",reason:`核实 ${prices.length} 项同套餐、同币种、同周期报价`,prices,link:evidence};
  return seen?{state:"needs_evidence",reason:"公开页未提供可确认的原套餐与计费条件，保留已有报价",link:evidence}:failed!;
}

async function checkEntry(url:string,visit:Visit):Promise<Finding> {
  const result=await checkWebsite(url,visit);
  const state=result.reason.includes("目标为登录或付款页面")?"restricted":result.state;
  return {state,reason:result.reason,link:result.finalUrl};
}

function applyPrices(db:DatabaseSync,facts:PriceFact[],stamp:string) {
  if (!facts.length) return {verified:0,changed:0};
  const current=new Map(currentPublicQuotes(db).map(row=>[row.id,row]));
  let verified=0,changed=0;
  for (const {quote,amount,source} of facts) {
    const live=current.get(quote.id);
    if (!live||live.amount_minor!==quote.amount_minor||live.recorded_at!==quote.recorded_at||live.source_id!==quote.source_id||
      live.plan!==quote.plan||live.currency!==quote.currency||live.period!==quote.period||live.region!==quote.region) continue;
    verified++;
    if (amount===quote.amount_minor) continue;
    const excerpt=`${quote.plan} · ${quote.currency} 最小货币单位 ${amount} · ${quote.period} · ${quote.region}`;
    db.prepare(`INSERT OR IGNORE INTO sources(site_id,title,url,accessed_at,kind,verified,excerpt,digest)
      VALUES (?,'商家公开报价',?,?,'official',1,?,?)`).run(quote.site_id,source,stamp,excerpt,createHash("sha256").update(excerpt).digest("hex"));
    const owner=one<{id:number}>(db,"SELECT id FROM sources WHERE site_id=? AND url=? AND accessed_at=?",quote.site_id,source,stamp)!;
    const id=db.prepare(`INSERT INTO price_records(site_id,source_id,plan,amount_minor,currency,period,region,notes,recorded_at,publication)
      VALUES (?,?,?,?,?,?,?,'官网定时核对',?,'published')`).run(quote.site_id,owner.id,quote.plan,amount,quote.currency,quote.period,quote.region,stamp).lastInsertRowid;
    audit(db,actor,"verified_price_change","price_records",Number(id),{id:quote.id,amount:quote.amount_minor},{amount,source,recorded_at:stamp});
    changed++;
  }
  return {verified,changed};
}

function recordFinding(db:DatabaseSync,lease:RefreshLease,target:RefreshTarget,result:Finding,stamp:string) {
  transaction(db,()=>{
    if (!ownsRefresh(db,lease)) return;
    const prices=applyPrices(db,result.prices??[],stamp);
    db.prepare(`UPDATE directory_refresh_targets SET checked_at=?,result=?,reason=?,evidence_url=?,quotes_checked=?,quotes_changed=? WHERE id=?`)
      .run(stamp,result.state,result.reason,result.link??null,prices.verified,prices.changed,target.id);
    if (target.kind==="site") db.prepare(`UPDATE sites SET checked_at=?,reachability=? WHERE id=? AND website=?
      AND publication='published' AND lifecycle<>'closed' AND (checked_at IS NULL OR checked_at<=?)`).run(stamp,result.state,target.site_id,target.url,stamp);
  });
}

export async function runDirectoryRefresh(db:DatabaseSync,options:RunnerOptions={}) {
  const {clock=Date.now,signal}=options;
  const rate=Number(process.env.MERCHANT_REFRESH_RATE??6);
  const transport=options.visit??websiteVisit(parseProxy(process.env.MERCHANT_PROXY));
  const visit=guarded(options.visit??limitedBacklogVisit(transport,Number.isInteger(rate)&&rate>=1&&rate<=12?rate:6,1200));
  const rateVisit=options.rateVisit??options.visit??limitedBacklogVisit(transport,1,5000);
  const lease=claimRefresh(db,clock());
  if (!lease) return {claimed:false,...directoryRefreshStatus(db)};
  let error="";
  const heartbeat=setInterval(()=>renewRefresh(db,lease,clock()),20_000).unref();
  try {
    await Promise.all([refreshExchange(db,lease,clock,rateVisit),discoverQuotePages(db,lease,options.search??searchDeepSeek)]);
    const hints=JSON.parse(one<{search_urls:string}>(db,"SELECT search_urls FROM directory_refresh_runs WHERE id=?",lease.run.id)!.search_urls) as string[];
    const work=pendingRefreshTargets(db,lease.run.id,Math.max(1,Math.min(250,options.batch??120)));
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(12,work.length)},async()=>{
      while (!signal?.aborted&&cursor<work.length&&ownsRefresh(db,lease)) {
        const target=work[cursor++];
        let outcome:Finding;
        try {
          if(target.kind==="domain")outcome={state:"skipped",reason:"旧版域名专栏已下线"};
          else outcome=target.kind==="price"?await checkPrices(db,target,visit,clock,hints):await checkEntry(target.url,visit);
        }
        catch (e) { outcome=failedPage(e); }
        recordFinding(db,lease,target,outcome,new Date(clock()).toISOString());
      }
    }));
  } catch (cause) { error=reason(cause); }
  finally { clearInterval(heartbeat);finishRefreshBatch(db,lease,clock(),error); }
  return {claimed:true,...directoryRefreshStatus(db)};
}
