import type { DatabaseSync } from "node:sqlite";
import { recordCoverage } from "./coverage";
import { all,one,transaction } from "./db";
import { deepSeekSearchReference,searchDeepSeek } from "./deepseek-search";
import { reserveDeepSeekSearch,type DiscoverySource } from "./discovery";
import { discoverFrom,type Lead } from "./discovery-providers";
import { merchantSearchLead } from "./discovery-rules";
import { focusedMerchantSeeds } from "./focused-merchant-queries";
import { approveItems,getBatch,publishBatch } from "./imports";
import { merchantNameKey } from "./merchant-evidence";
import { assessAutomatedAdmission,preferredBasicDetail,type LeadPage } from "./merchant-lead-page";
import { campaignSeeds } from "./merchant-queries";
import { comparablePeriod } from "./price-board";
import { publicProductObservation,publicShelfObservation } from "./public-product-quote";
import { amountMinor,structuredPublicQuotes } from "./refresh-quotes";
import { ownsRefresh,type RefreshLease } from "./refresh-state";
import { isRelayTokenPeriod,relayRateRegion } from "./relay-quote-units";
import { saveObservedStorefrontAvailability } from "./storefront-availability";
import { isStorefrontPlatform,storefrontIdentity } from "./storefront-identity";
import { writeStorefrontObservation,type StorefrontObservation } from "./storefront-import";
import { isRetiredCategory,pipelineForCategory,type Pipeline } from "./taxonomy";
import { websiteUrl } from "./validation";
import { readPublicPage,type Visit } from "./website-check";
import { audit } from "./write";

const actor="directory-refresh";
const searchUnitMilli=6; // Conservative CNY estimate. The shared ledger caps actual attempts.
const rotation:Pipeline[]=["ai-retail","ai-retail","ai-relay","payments","vps"];
const queries=[...focusedMerchantSeeds(),...campaignSeeds()].sort((a,b)=>a.priority-b.priority);
const suspendedPlatforms=new Set(["16688.com.cn","catfk.com"]);
export const privateRefreshPath=/\/(?:login|sign-?in|signup|sign-up|register|account|dashboard|console|auth|checkout|pay|redeem|token)(?:[/.-]|$)/i;

type Result="published"|"updated"|"known"|"restricted"|"unreachable"|"needs_evidence"|"review"|"error";
type QueuedLead={id:number;url:string;source_url:string;pipeline:Pipeline;identity:string};
type CurrentSite={id:number;name:string;category_slug:string;publication:string;lifecycle:string};
type Target={url:string;identity:string;domain:string;rank:number};
type Evidence={url:string;name:string;category:string;regionQuotes:ReturnType<typeof structuredPublicQuotes>;shop?:StorefrontObservation};

export function refreshAccessRule(db:DatabaseSync) {
  const blocked=new Set(suspendedPlatforms);
  for (const {url} of all<{url:string}>(db,"SELECT url FROM discovery_sources WHERE access='restricted'")) {
    blocked.add(websiteUrl(url).registrable);
  }
  return (url:string)=>blocked.has(websiteUrl(url).registrable);
}

function candidateTarget(raw:string):Target|undefined {
  try {
    const {target}=merchantSearchLead(raw);
    const store=storefrontIdentity(target.url);
    if (isStorefrontPlatform(target.domain)) {
      return store?{url:store.url,identity:"shop:"+store.key,domain:store.registrable,rank:10}:undefined;
    }
    const url=new URL(target.url);
    if (privateRefreshPath.test(url.pathname)||/\/sitemaps?(?:[./]|$)/i.test(url.pathname)) return;
    return {url:url.href,identity:"domain:"+target.registrable,domain:target.registrable,rank:preferredBasicDetail(url.pathname)};
  } catch { return; }
}

function queueLeads(db:DatabaseSync,run:number,leads:Lead[],pipeline:Pipeline,sourceUrl:string,clock:number) {
  const grouped=new Map<string,Target>();
  for (const {url} of leads) {
    const target=candidateTarget(url);
    if (target&&target.rank>(grouped.get(target.identity)?.rank??-1)) grouped.set(target.identity,target);
  }
  const previous=db.prepare(`SELECT checked_at FROM directory_refresh_leads WHERE identity=? AND run_id<>?
    AND result IN ('needs_evidence','restricted','unreachable','review','error') ORDER BY id DESC LIMIT 1`);
  const insert=db.prepare(`INSERT OR IGNORE INTO directory_refresh_leads(run_id,identity,pipeline,url,source_url,found_at) VALUES (?,?,?,?,?,?)`);
  const time=new Date(clock).toISOString();
  for (const lead of [...grouped.values()].slice(0,50)) {
    const earlier=previous.get(lead.identity,run) as {checked_at:string}|undefined;
    if (earlier&&clock-Date.parse(earlier.checked_at)<24*60*60_000) continue;
    insert.run(run,lead.identity,pipeline,lead.url,sourceUrl,time);
  }
}

async function collectDeepSeek(db:DatabaseSync,lease:RefreshLease,clock:()=>number,search:typeof searchDeepSeek) {
  const {run,token}=lease;
  if (run.search_state!=="pending") return;
  if (!process.env.DEEPSEEK_API_KEY?.trim()&&search===searchDeepSeek) {
    db.prepare("UPDATE directory_refresh_runs SET search_state='skipped',search_error='未配置 DeepSeek API Key' WHERE id=? AND token=?").run(run.id,token);
    return;
  }
  const count=one<{n:number}>(db,"SELECT count(*) n FROM directory_refresh_runs WHERE automatic_discovery=1 AND search_reserved_milli>0")!.n;
  const slot=count%rotation.length;
  const pipeline=rotation[slot];
  const index=Math.floor(count/rotation.length)*rotation.filter(kind=>kind===pipeline).length+rotation.slice(0,slot).filter(kind=>kind===pipeline).length;
  const english=index%4===3;
  const pool=queries.filter(row=>row.pipeline===pipeline&&row.query.endsWith(english?" lang:en":" lang:zh"));
  const offset=english?Math.floor(index/4):index-Math.floor(index/4);
  const {query}=pool[offset%pool.length];
  try {
    const found=await search(query,50,undefined,()=>transaction(db,()=>{
      if (!ownsRefresh(db,lease)) throw new Error("刷新运行权已转移");
      reserveDeepSeekSearch(db);
      db.prepare("UPDATE directory_refresh_runs SET search_state='reserved',search_query=?,search_reserved_milli=? WHERE id=? AND token=?")
        .run(query,searchUnitMilli,run.id,token);
    }));
    transaction(db,()=>{
      if (!ownsRefresh(db,lease)) return;
      queueLeads(db,run.id,found.urls.map(url=>({url})),pipeline,deepSeekSearchReference,clock());
      db.prepare("UPDATE directory_refresh_runs SET search_state=?,search_billable_milli=? WHERE id=? AND token=?")
        .run(found.returned?"done":"empty",found.returned?searchUnitMilli:0,run.id,token);
    });
  } catch (error) {
    const message=error instanceof Error?error.message:"";
    const skipped=/每日请求额度|今日请求额度/.test(message);
    db.prepare("UPDATE directory_refresh_runs SET search_state=?,search_query=?,search_error=? WHERE id=? AND token=?")
      .run(skipped?"skipped":"failed",query,/^DeepSeek Search |^未设置 /.test(message)?message.slice(0,180):"DeepSeek 搜索商家未完成",run.id,token);
  }
}

export async function collectRefreshLeads(db:DatabaseSync,lease:RefreshLease,visit:Visit,clock:()=>number,search:typeof searchDeepSeek,stop?:AbortSignal) {
  if (stop?.aborted) return;
  await collectDeepSeek(db,lease,clock,search);
  const tasks=all<DiscoverySource>(db,`SELECT s.* FROM directory_refresh_sources tasks JOIN discovery_sources s ON s.id=tasks.source_id
    WHERE tasks.run_id=? AND tasks.state='pending' ORDER BY s.id`,lease.run.id);
  for (const source of tasks) {
    if (stop?.aborted||!ownsRefresh(db,lease)) return;
    const finish=db.prepare("UPDATE directory_refresh_sources SET state=?,error=? WHERE run_id=? AND source_id=?");
    try {
      const permitted=(s:DiscoverySource|undefined)=>s?.enabled===1&&s.pipeline!=="connections"&&s.access===source.access&&s.url===source.url&&s.kind===source.kind&&
        s.evidence_url===source.evidence_url&&s.pipeline===source.pipeline&&["official","licensed"].includes(s.access);
      const current=()=>one<DiscoverySource>(db,"SELECT * FROM discovery_sources WHERE id=?",source.id);
      if (!permitted(current())) {
        finish.run("skipped","来源授权或配置已更改",lease.run.id,source.id);
        continue;
      }
      const found=await discoverFrom(source,{read:(url,_request,max)=>readPublicPage(url,visit,max)});
      transaction(db,()=>{
        if (!ownsRefresh(db,lease)||stop?.aborted) return;
        if (!permitted(current())) {
          finish.run("skipped","来源授权或配置已更改",lease.run.id,source.id);
          return;
        }
        const urls=source.kind==="page"&&source.access==="official"?[{url:source.url},...found.leads]:found.leads;
        queueLeads(db,lease.run.id,urls,source.pipeline,source.url,clock());
        finish.run("collected",found.errors.join("；").slice(0,180),lease.run.id,source.id);
      });
    } catch (error) {
      if (!stop?.aborted&&ownsRefresh(db,lease)) finish.run("failed",refreshFailure(error).reason,lease.run.id,source.id);
    }
  }
}

export function refreshFailure(error:unknown) {
  const reason=(error instanceof Error?error.message:"公开页面请求未完成").slice(0,180);
  const state=/robots|访问验证|登录或付款|来源限制|\[(?:address|proxy)_policy\]|HTTP (?:401|403|407|429|451)\b/.test(reason)?"restricted":
    /跳往|HTTP \d{3}|上限/.test(reason)?"inconclusive":"unreachable";
  return {state,reason} as const;
}

function findSites(db:DatabaseSync,target:Target) {
  const fields="s.id,s.name,s.category_slug,s.publication,s.lifecycle";
  if (target.identity.startsWith("shop:")) return all<CurrentSite>(db,`SELECT ${fields} FROM sites s
    JOIN merchant_storefronts f ON f.site_id=s.id WHERE f.storefront_key=?`,target.identity.slice(5));
  return all<CurrentSite>(db,`SELECT DISTINCT ${fields} FROM sites s JOIN site_domains d ON d.site_id=s.id WHERE d.registrable=?`,target.domain);
}

function publishProfile(db:DatabaseSync,lead:QueuedLead,target:Target,evidence:Evidence,stamp:string) {
  const pipeline=pipelineForCategory(evidence.category)!;
  const siteUrl=new URL(evidence.url).origin+"/";
  const batch=recordCoverage(db,{pipeline,source_name:"五小时官网发现",source_url:lead.source_url,evidence_url:evidence.url,access:"official"},
    JSON.stringify([{url:siteUrl,category:evidence.category,name:evidence.name,source_url:evidence.url,basis:"basic",
      source_kind:"official",source_title:"商家公开服务资料",snapshot_at:stamp.slice(0,10)}]),"json",actor,true).batch_id!;
  const items=getBatch(batch,db);
  const item=items.length===1?items[0]:undefined;
  if (!item||item.state!=="ready"||item.registrable!==target.domain) return;
  db.prepare("UPDATE import_items SET checked_at=?,reachability='reachable',check_detail=?,final_url=? WHERE id=?")
    .run(stamp,"官网公开页面展示目标商品或服务",evidence.url,item.id);
  if (approveItems(db,batch,[item.id],actor,true).count!==1||publishBatch(db,batch,actor,[item.id],true)!==1) return;
  return one<{site_id:number}>(db,"SELECT site_id FROM import_items WHERE id=? AND state='published'",item.id)?.site_id;
}

export function addServiceQuotes(db:DatabaseSync,site:number,evidence:Pick<Evidence,"url"|"category"|"regionQuotes">,stamp:string) {
  const offers=new Map<string,{plan:string;price:number;currency:string;period:string;region:string;scale:number|null}>();
  const conflicts=new Set<string>();
  for (const quote of evidence.regionQuotes) {
    const period=comparablePeriod(quote.period);
    const token=evidence.category==="ai-relay"&&isRelayTokenPeriod(period);
    if ((!token&&!/^(?:月|年|周|日|季|季付|一次性|每次|P\d{1,2}[DWMY])$/.test(period))||!["CNY","USD","EUR","GBP","HKD","JPY","SGD"].includes(quote.currency)) continue;
    const scale=token?6:null;
    const price=amountMinor(quote.amount,quote.currency,scale);
    if (price==null||price<=0) continue;
    const region=quote.region??(token?relayRateRegion:"未注明");
    const key=JSON.stringify([merchantNameKey(quote.plan),period,quote.currency,region]);
    if (offers.has(key)&&offers.get(key)!.price!==price) conflicts.add(key);
    offers.set(key,{plan:quote.plan,price,currency:quote.currency,period,region,scale});
  }
  const unique=[...offers].filter(([key])=>!conflicts.has(key));
  let changed=0;
  for (const [,quote] of unique) {
    const existing=all<{period:string}>(db,`SELECT DISTINCT period FROM price_records WHERE site_id=? AND plan=? COLLATE NOCASE AND currency=? AND region=? AND publication='published'`,
      site,quote.plan,quote.currency,quote.region);
    if (existing.some(row=>comparablePeriod(row.period)===quote.period)) continue;
    const excerpt=`${quote.plan} · ${quote.currency} · ${quote.period} · ${quote.region}`;
    db.prepare(`INSERT OR IGNORE INTO sources(site_id,title,url,accessed_at,kind,verified) VALUES (?,'商家公开套餐报价',?,?,'official',1)`).run(site,evidence.url,stamp);
    const source=one<{id:number}>(db,"SELECT id FROM sources WHERE site_id=? AND url=? AND accessed_at=? AND kind='official' AND verified=1",site,evidence.url,stamp);
    if (!source) continue;
    const id=db.prepare(`INSERT INTO price_records(site_id,source_id,plan,amount_minor,amount_scale,currency,period,region,notes,recorded_at,publication)
      VALUES (?,?,?,?,?,?,?,?,'官网公开套餐报价',?,'published')`)
      .run(site,source.id,quote.plan,quote.price,quote.scale,quote.currency,quote.period,quote.region,stamp).lastInsertRowid;
    audit(db,actor,"public_price_added","price_records",Number(id),null,{excerpt,amount:quote.price,source:evidence.url});
    changed++;
  }
  return {checked:unique.length,changed};
}

export function readShopObservation(page:LeadPage,stamp:string,name:string,category:StorefrontObservation["category"],discoveryUrl?:string) {
  if (page.truncated||!/html/i.test(page.contentType)) return;
  const observation=publicProductObservation(page.body,page.url,stamp,discoveryUrl)??
    publicShelfObservation(page.body,page.url,stamp,name,category);
  if (observation&&merchantNameKey(observation.name)===merchantNameKey(websiteUrl(page.url).registrable)) observation.name=name;
  if (observation) observation.discoveryUrl=discoveryUrl;
  return observation;
}

export function saveShopObservation(db:DatabaseSync,observed:StorefrontObservation,existingSite?:number,sourceActor=actor) {
  if (existingSite) {
    // Preserve the original plan identity for an offer re-observed on the same source page.
    for (const offer of observed.offers) {
      const prior=all<{plan:string;period:string;region:string;product_title:string|null}>(db,`SELECT DISTINCT p.plan,p.period,p.region,p.product_title
        FROM price_records p JOIN sources src ON src.id=p.source_id WHERE p.site_id=? AND src.url=?
        AND p.storefront_observed=1 AND p.reported_item_url IS NULL AND p.publication='published'
        AND coalesce(p.product_title,p.plan)=? COLLATE NOCASE`,existingSite,observed.sourceUrl,offer.productTitle??offer.plan)
        .filter(row=>comparablePeriod(row.period)===comparablePeriod(offer.period));
      if (prior.length===1) Object.assign(offer,{plan:prior[0].plan,period:prior[0].period,region:prior[0].region,productTitle:prior[0].product_title??offer.productTitle});
    }
  }
  const saved=writeStorefrontObservation(db,observed,sourceActor);
  if (existingSite&&saved.siteId!==existingSite) throw new Error("店铺归属已经改变");
  saveObservedStorefrontAvailability(db,saved.siteId,observed);
  return saved;
}

function storeResult(db:DatabaseSync,lead:QueuedLead,result:Result,reason:string,stamp:string,evidence?:string,site?:number,checked=0,changed=0) {
  db.prepare(`UPDATE directory_refresh_leads SET checked_at=?,result=?,reason=?,evidence_url=?,site_id=?,quotes_checked=?,quotes_changed=?
    WHERE id=? AND checked_at IS NULL`).run(stamp,result,reason,evidence??null,site??null,checked,changed,lead.id);
}

function saveEvidence(db:DatabaseSync,lead:QueuedLead,target:Target,evidence:Evidence,stamp:string) {
  const record=(result:Result,reason:string,site?:number,checked=0,changed=0)=>storeResult(db,lead,result,reason,stamp,evidence.url,site,checked,changed);
  const candidates=findSites(db,target);
  const old=candidates[0];
  const retail=evidence.category==="ai-topup"||evidence.category==="ai-card";
  if (candidates.length>1||old&&(old.publication!=="published"||old.lifecycle==="closed"||
    (retail?!["ai-topup","ai-card"].includes(old.category_slug):old.category_slug!==evidence.category))) {
    return record("review","已存在不同分类、已停运或未公开档案，需确认归属。");
  }
  if (!old) {
    const nameKey=merchantNameKey(evidence.name);
    if (nameKey.length<2||nameKey===merchantNameKey(target.domain)||all<{name:string;aliases:string}>(db,"SELECT name,aliases FROM sites")
      .some(s=>[s.name,...JSON.parse(s.aliases) as string[]].some(name=>merchantNameKey(name)===nameKey))) {
      return record("review","官网名称缺失或与现有品牌或别名重合。");
    }
    if (!target.identity.startsWith("shop:")&&one(db,`SELECT id FROM import_items WHERE registrable=? AND state IN ('rejected','ready','approved','published') LIMIT 1`,target.domain)) {
      return record("review","该域已有审核记录，请沿用原条目的审核结果。");
    }
  }
  if (retail) {
    if (!evidence.shop?.offers.length) return record("needs_evidence","已读到店铺页面，缺少能对应到商品的明确人民币标价。",old?.id);
    const saved=saveShopObservation(db,evidence.shop,old?.id);
    return record(saved.created?"published":saved.prices?"updated":"known","官网商品和人民币标价已记录。",saved.siteId,evidence.shop.offers.length,saved.prices);
  }
  const site=old?.id??publishProfile(db,lead,target,evidence,stamp);
  if (!site) return record("review","已有审核占用或发布校验未通过。");
  const quotes=addServiceQuotes(db,site,evidence,stamp);
  if (quotes.changed) db.prepare("UPDATE sites SET updated_at=max(updated_at,?) WHERE id=?").run(stamp,site);
  record(old?quotes.changed?"updated":"known":"published","已记录官网公开服务资料。",site,quotes.checked,quotes.changed);
}

export async function processRefreshLead(db:DatabaseSync,lease:RefreshLease,lead:QueuedLead,visit:Visit,clock:()=>number,stop?:AbortSignal) {
  const stamp=()=>new Date(clock()).toISOString();
  const write=(result:Result,reason:string,evidence?:string)=>transaction(db,()=>{
    if (!stop?.aborted&&ownsRefresh(db,lease)) storeResult(db,lead,result,reason,stamp(),evidence);
  });
  if (lead.pipeline==="connections") return write("review","此采集分类已下架。");
  const target=candidateTarget(lead.url);
  if (!target) return write("needs_evidence","缺少可核对的独立官网或店铺链接。");
  const first=new URL(lead.url);
  const pages=target.identity.startsWith("shop:")?[first.href]:[...new Set([first.href,first.origin+"/"])];
  let failure:{result:Result;reason:string;evidence?:string}={result:"needs_evidence",reason:"未找到可公开核对的商品、套餐或服务入口。"};
  const seen=new Set<string>();
  for (const url of pages) {
    if (stop?.aborted||!ownsRefresh(db,lease)||seen.size>=3) return;
    if (seen.has(url)) continue;
    seen.add(url);
    let page;
    try { page=await readPublicPage(url,visit,720_000,16_000,1); }
    catch (error) {
      const attempt=refreshFailure(error);
      if (attempt.state==="restricted") return write("restricted",attempt.reason);
      if (failure.result!=="needs_evidence"||!failure.evidence) failure={result:attempt.state==="unreachable"?"unreachable":"needs_evidence",reason:attempt.reason};
      continue;
    }
    const actual=candidateTarget(page.url);
    if (actual?.identity!==target.identity) return write("review","公开入口或重定向指向不同的店铺身份。",page.url);
    if (page.truncated||!/html/i.test(page.contentType)) continue;
    const assessment=assessAutomatedAdmission(lead.pipeline,page);
    if (assessment.category&&isRetiredCategory(assessment.category)) return write("review","此服务分类已下架。",page.url);
    if (assessment.detail&&candidateTarget(assessment.detail)?.identity===target.identity&&!pages.includes(assessment.detail)&&pages.length<3) {
      pages.push(assessment.detail);
    }
    if (assessment.outcome!=="merchant"||!assessment.name||!assessment.category||!pipelineForCategory(assessment.category)||assessment.checkout) {
      failure={result:assessment.checkout||assessment.outcome==="redirect"?"review":"needs_evidence",reason:assessment.reason,evidence:page.url};
      continue;
    }
    const isRetail=assessment.category==="ai-topup"||assessment.category==="ai-card";
    const time=stamp();
    const shop=isRetail?readShopObservation(page,time,assessment.name,assessment.category as StorefrontObservation["category"],lead.source_url):undefined;
    if (shop&&merchantNameKey(shop.name)!==merchantNameKey(assessment.name)&&merchantNameKey(assessment.name)!==merchantNameKey(target.domain)) {
      return write("review","店铺名称和公开商品标注的卖家名称不一致。",page.url);
    }
    if (isRetail&&!shop) {
      failure={result:"needs_evidence",reason:"可访问的店铺页面暂缺明确人民币商品标价。",evidence:page.url};
      continue;
    }
    const evidence={url:page.url,name:shop?.name??assessment.name,category:shop?.category??assessment.category,shop,
      regionQuotes:isRetail?[]:structuredPublicQuotes(page.body,page.url,time)};
    try {
      return transaction(db,()=>{
        if (!stop?.aborted&&ownsRefresh(db,lease)) saveEvidence(db,lead,target,evidence,time);
      });
    } catch {
      return write("error","已取得官网证据，写入失败，保留来源待重试。",page.url);
    }
  }
  write(failure.result,failure.reason,failure.evidence);
}

export function pendingRefreshLeads(db:DatabaseSync,run:number,limit:number) {
  return all<QueuedLead>(db,`SELECT id,identity,url,source_url,pipeline FROM directory_refresh_leads
    WHERE run_id=? AND checked_at IS NULL ORDER BY id LIMIT ?`,run,limit);
}
