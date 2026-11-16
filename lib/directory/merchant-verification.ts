import type { DatabaseSync } from "node:sqlite";
import { recordCoverage } from "./coverage";
import { all,one,transaction } from "./db";
import { deepSeekSearchReference } from "./deepseek-search";
import { externalSalesLink } from "./discovery-providers";
import { merchantSearchLead } from "./discovery-rules";
import { reviseItem } from "./imports";
import { addMerchantQueries } from "./merchant-campaign";
import { merchantNameKey,merchantProof,type MerchantProof } from "./merchant-evidence";
import { evidenceSeeds } from "./merchant-queries";
import { pipelines,type Pipeline } from "./taxonomy";
import { now,textValue,websiteUrl } from "./validation";
import { readPublicPage } from "./website-check";
import { audit } from "./write";

type Candidate={id:number;campaign_id:number;pipeline:Pipeline;registrable:string;lease_until:string};
type Review={state:"ready"|"unverified"|"manual"|"filtered";reason:string;proof?:MerchantProof};
const immediate=(reason:string)=>/robots|HTTP (?:401|403|429|451)|访问验证|其他注册域|私有|不可用|超时|aborted|ENOTFOUND|证书|\[(?:address_policy|proxy_policy|config)\]/i.test(reason);
const paymentProcessors=new Set(["stripe.com","paypal.com","paddle.com","lemonsqueezy.com","2checkout.com"]);

function claimCandidate(db:DatabaseSync,id:number,pipeline?:Pipeline) {
  return transaction(db,()=>{
    if (!one(db,"SELECT 1 FROM merchant_campaigns WHERE id=? AND state IN ('running','blocked')",id)) return undefined;
    const moment=now();
    return one<Candidate>(db,`UPDATE merchant_candidates SET state='checking',lease_until=? WHERE id=(SELECT id FROM merchant_candidates
      WHERE campaign_id=? AND (state='queued' OR (state='checking' AND lease_until<=?)) AND (? IS NULL OR pipeline=?) ORDER BY id LIMIT 1) RETURNING *`,
    new Date(Date.now()+120_000).toISOString(),id,moment,pipeline??null,pipeline??null);
  });
}

function canonDomain(body:string,page:string) {
  const canonical=[...body.matchAll(/<link\b[^>]*>/gi)].find(match=>/\brel\s*=\s*["']canonical["']/i.test(match[0]))?.[0]
    .match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!canonical) return "";
  try { return websiteUrl(new URL(canonical,page).href).registrable; } catch { return ""; }
}

async function checkCandidate(db:DatabaseSync,row:Candidate,read:(url:string)=>ReturnType<typeof readPublicPage>):Promise<Review> {
  const refs=all<{url:string}>(db,`SELECT url FROM (
    SELECT url,filter_reason,id,0 rank FROM merchant_source_links WHERE candidate_id=?
    UNION ALL SELECT url,filter_reason,id,1 rank FROM merchant_urls WHERE candidate_id=?
    ) ORDER BY filter_reason<>'',rank,id LIMIT 8`,row.id,row.id);
  const pages=refs.flatMap(ref=>{
    try { return [merchantSearchLead(ref.url).target]; } catch { return []; }
  });
  const first=pages[0];
  if (!first) return {state:"filtered",reason:"无符合核查规则的公开网址"};
  const fallback=first.url!==first.homepage?first.homepage:pages.find(ref=>ref.url!==first.homepage)?.url;
  let reason="官网公开页面未取得明确的商家身份与产品证据";
  let readHtml=false;
  for (const url of [...new Set([first.url,fallback].filter(Boolean))] as string[]) {
    let page;
    try { page=await read(url); }
    catch (error) {
      reason=error instanceof Error?error.message.slice(0,170):"官网请求未完成";
      if (immediate(reason)) return {state:/其他注册域/.test(reason)?"manual":"unverified",reason};
      continue;
    }
    if (!/html/i.test(page.contentType)) continue;
    readHtml=true;
    const canonical=canonDomain(page.body,page.url);
    if (canonical&&canonical!==row.registrable) return {state:"manual",reason:`规范网址指向 ${canonical}`};
    const external=externalSalesLink(page.body,page.url);
    if (external&&!paymentProcessors.has(external)) return {state:"manual",reason:`购买入口指向 ${external}`};
    const proof=merchantProof(row.pipeline,page);
    if (proof) return {state:"ready",reason:"已核对官网与服务类型，待编辑审核",proof};
  }
  return {state:readHtml?"filtered":"unverified",reason};
}

function persistReview(db:DatabaseSync,row:Candidate,review:Review,elapsedMs:number) {
  transaction(db,()=>{
    const proof=review.proof;
    if (proof) {
      const registered=all<{name:string;aliases:string}>(db,"SELECT name,aliases FROM sites WHERE publication<>'archived'");
      const names=[proof.name,...proof.aliases].map(merchantNameKey).filter(name=>name.length>=3);
      const nameClash=registered.some(site=>[site.name,...JSON.parse(site.aliases) as string[]].some(name=>names.includes(merchantNameKey(name))));
      const mirror=one(db,`SELECT 1 FROM merchant_candidates WHERE campaign_id=? AND id<>? AND state IN ('ready','manual')
        AND json_extract(details,'$.identity')=? AND json_extract(details,'$.name')=?`,row.campaign_id,row.id,proof.identity,proof.name);
      if (nameClash||mirror) review={...review,state:"manual",reason:"品牌名称、别名或公开页面指纹重复，须确认主体"};
    }
    const updated=db.prepare(`UPDATE merchant_candidates SET state=?,reason=?,details=?,checked_at=?,lease_until='',pipeline=?
      WHERE id=? AND state='checking' AND lease_until=?`).run(review.state,review.reason,JSON.stringify(proof??{}),now(),proof?.pipeline??row.pipeline,row.id,row.lease_until);
    if (updated.changes) db.prepare(`INSERT INTO merchant_verification_attempts(candidate_id,checked_at,outcome,reason,elapsed_ms,proof_url)
      VALUES (?,?,?,?,?,?)`).run(row.id,now(),review.state,review.reason,elapsedMs,proof?.url??null);
    if (updated.changes&&proof&&review.state==="ready") {
      addMerchantQueries(db,row.campaign_id,proof.terms.flatMap(term=>evidenceSeeds(proof.pipeline,term)));
    }
  });
}

export async function verifyMerchantCampaign(db:DatabaseSync,id:number,limit:number,pipeline?:Pipeline,
  read:(url:string)=>ReturnType<typeof readPublicPage> = url=>readPublicPage(url,undefined,100_000)) {
  if (!Number.isSafeInteger(limit)||limit<1||limit>10_000) throw new Error("核查批次须为 1 至 10,000 条。");
  const rawWorkers=Number(process.env.MERCHANT_VERIFY_WORKERS??16);
  const workers=Number.isSafeInteger(rawWorkers)&&rawWorkers>=1&&rawWorkers<=24 ? rawWorkers : 16;
  let claimed=0,complete=0;
  await Promise.all(Array.from({length:Math.min(workers,limit)},async()=>{
    while (claimed<limit) {
      const row=claimCandidate(db,id,pipeline);
      if (!row) return;
      claimed++;
      const started=performance.now();
      const review=await checkCandidate(db,row,read);
      persistReview(db,row,review,Math.round(performance.now()-started));
      if (++complete%50===0) console.error(`采集 #${id} 已核查 ${complete} 个注册域`);
    }
  }));
  return complete;
}

export function requeueMerchantTimeouts(db:DatabaseSync,campaign:number,limit:number) {
  return transaction(db,()=>Number(db.prepare(`UPDATE merchant_candidates SET state='queued',lease_until='' WHERE id IN (
    SELECT c.id FROM merchant_candidates c WHERE c.campaign_id=? AND c.state='unverified'
      AND (lower(c.reason) LIKE '%timeout%' OR lower(c.reason) LIKE '%aborted%' OR c.reason LIKE '%超时%')
      AND (SELECT count(*) FROM merchant_verification_attempts a WHERE a.candidate_id=c.id)<2
      ORDER BY c.id LIMIT ? )`).run(campaign,Math.min(500,limit)).changes));
}

export function stageMerchantCampaign(db:DatabaseSync,id:number,actor:string) {
  return transaction(db,()=>{
    const staged:{pipeline:Pipeline;batch:number;items:number}[]=[];
    const previous=all<{id:number;item_id:number;checked_at:string;details:string;batch_id:number;pipeline:Pipeline}>(db,`SELECT c.*,i.batch_id FROM merchant_candidates c JOIN import_items i ON i.id=c.item_id
      JOIN coverage_runs r ON r.batch_id=i.batch_id WHERE c.campaign_id=? AND c.state='ready' AND i.state='ready'
      AND i.message LIKE '暂缓审核：需按新版商业主体%' AND c.pipeline=r.pipeline AND json_extract(c.details,'$.version')=2`,id);
    for (const row of previous) {
      const proof=JSON.parse(row.details) as MerchantProof;
      reviseItem(db,row.item_id,JSON.stringify(importRecord(proof)),actor,false,true);
      storeReachability(db,row.item_id,row.id,row.checked_at,proof);
    }
    for (const pipeline of Object.keys(pipelines) as Pipeline[]) {
      const rows=all<{id:number;registrable:string;details:string;checked_at:string}>(db,`SELECT id,registrable,details,checked_at FROM merchant_candidates
        WHERE campaign_id=? AND pipeline=? AND state='ready' AND item_id IS NULL AND json_extract(details,'$.version')=2 ORDER BY id LIMIT 5000`,id,pipeline);
      if (!rows.length) continue;
      const entries=rows.map(row=>importRecord(JSON.parse(row.details) as MerchantProof));
      const intake=recordCoverage(db,{pipeline,source_name:`独立商家采集 #${id} ${pipelines[pipeline].label}`,source_url:"https://shanhainexus.com/policy",
        evidence_url:"https://shanhainexus.com/policy",access:"official",reason:"发现来源单独记录；名称和服务从逐站公开官网核对。"},JSON.stringify(entries),"json",actor,true);
      if (!intake.batch_id) continue;
      const items=all<{id:number;registrable:string;state:string}>(db,"SELECT id,registrable,state FROM import_items WHERE batch_id=?",intake.batch_id);
      const indexed=new Map(items.map(item=>[item.registrable,item]));
      for (const row of rows) {
        const item=indexed.get(row.registrable);
        const proof=JSON.parse(row.details) as MerchantProof;
        if (!item||item.state!=="ready") {
          db.prepare("UPDATE merchant_candidates SET state='manual',item_id=?,reason=? WHERE id=?")
            .run(item?.id??null,item?.state==="duplicate"?"域名已在旧审核池，需人工合并证据":"导入字段待确认",row.id);
          continue;
        }
        db.prepare("UPDATE merchant_candidates SET item_id=? WHERE id=?").run(item.id,row.id);
        storeReachability(db,item.id,row.id,row.checked_at,proof);
      }
      staged.push({pipeline,batch:intake.batch_id,items:items.filter(item=>item.state==="ready").length});
    }
    return staged;
  });
}

export function reconcileMerchantCandidate(db:DatabaseSync,campaign:number,id:number,actor:string) {
  return transaction(db,()=>{
    const row=one<{id:number;item_id:number;registrable:string;details:string;checked_at:string}>(db,`SELECT c.* FROM merchant_candidates c
      JOIN import_items i ON i.id=c.item_id WHERE c.campaign_id=? AND c.id=? AND c.state='manual' AND i.state='duplicate'
      AND c.reason='域名已在旧审核池，需人工合并证据' AND json_extract(c.details,'$.version')=2`,campaign,id);
    if (!row||one(db,"SELECT 1 FROM site_domains WHERE registrable=?",row.registrable)) throw new Error("该候选不能合并到待审核批次。");
    const old=all<{id:number;state:string;message:string}>(db,`SELECT id,state,message FROM import_items
      WHERE registrable=? AND id<>? AND state IN ('ready','approved')`,row.registrable,row.item_id);
    if (old.length!==1 || old[0].state!=="ready") throw new Error("必须恰有一条尚未批准的同域旧审核记录。");
    const proof=JSON.parse(row.details) as MerchantProof;
    const prior=old[0];
    const message=`同域公开证据已合并至候选 #${id}`;
    db.prepare("UPDATE import_items SET state='duplicate',message=? WHERE id=?").run(message,prior.id);
    audit(db,actor,"reconcile_candidate","import_items",prior.id,prior,{state:"duplicate",message,item:row.item_id});
    reviseItem(db,row.item_id,JSON.stringify(importRecord(proof)),actor,false,true);
    if (!one(db,"SELECT 1 FROM import_items WHERE id=? AND state='ready'",row.item_id)) throw new Error("合并后的记录未通过审核入池条件。");
    db.prepare(`INSERT OR IGNORE INTO candidate_sources(item_id,source_url,source_name,license_url,acquired_at)
      SELECT ?,source_url,source_name,license_url,acquired_at FROM candidate_sources WHERE item_id=?`).run(row.item_id,prior.id);
    storeReachability(db,row.item_id,row.id,row.checked_at,proof);
    db.prepare("UPDATE merchant_candidates SET state='ready',reason='已合并同域旧审核记录，待编辑审核' WHERE id=?").run(id);
    return row.item_id;
  });
}

function importRecord(proof:MerchantProof) {
  return {url:proof.root,name:proof.name,aliases:proof.aliases.join(","),category:proof.category,summary:proof.summary,
    basics:{products:proof.tags.join("、"),contact:proof.contact,refunds:proof.refund?`官网退款说明 ${proof.refund}`:""},
    source_url:proof.url,source_kind:"official",source_title:"官网公开服务页面",excerpt:proof.excerpt,website_language:proof.lang,
    ...(proof.pipeline==="ai-retail"?{operator_kind:"third_party"}:{})};
}

function storeReachability(db:DatabaseSync,item:number,candidateId:number,checkedAt:string,proof:MerchantProof) {
  db.prepare(`UPDATE import_items SET reachability='reachable',checked_at=?,check_detail='官网公开页面可达',final_url=? WHERE id=?`)
    .run(checkedAt,proof.url,item);
  db.prepare(`INSERT INTO website_checks(item_id,checked_at,result,http_status,final_url,reason) VALUES (?,?,'reachable',?,?,'官网公开页面可达')`)
    .run(item,checkedAt,proof.status,proof.url);
  db.prepare(`INSERT OR IGNORE INTO candidate_sources(item_id,source_url,source_name,acquired_at)
    SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM merchant_urls WHERE candidate_id=?)`)
    .run(item,deepSeekSearchReference,"DeepSeek Search · 发现来源",checkedAt.slice(0,10),candidateId);
  db.prepare(`INSERT OR IGNORE INTO candidate_sources(item_id,source_url,source_name,license_url,acquired_at)
    SELECT ?,l.evidence_url,json_extract(r.source_snapshot,'$.name'),CASE WHEN json_extract(r.source_snapshot,'$.access')='licensed'
      THEN json_extract(r.source_snapshot,'$.evidence_url') END,substr(r.created_at,1,10) FROM merchant_source_links l
      JOIN merchant_source_runs r ON r.id=l.run_id WHERE l.candidate_id=?`).run(item,candidateId);
}

export function rejectMerchantCandidates(db:DatabaseSync,campaign:number,ids:number[],reason:string,actor:string) {
  const message=textValue(reason,200,"拒绝原因");
  return transaction(db,()=>{
    let rejected=0;
    for (const id of [...new Set(ids)].slice(0,500)) {
      const row=one<{item_id:number|null;state:string;review:string|null}>(db,`SELECT c.item_id,c.state,i.state review FROM merchant_candidates c
        LEFT JOIN import_items i ON i.id=c.item_id WHERE c.campaign_id=? AND c.id=? AND c.state NOT IN ('checking','known','rejected')`,campaign,id);
      if (!row||row.review==="published") continue;
      if (row.item_id) db.prepare(`UPDATE import_items SET state='ready',message=? WHERE id=? AND state IN ('ready','approved')`)
        .run(`暂缓审核：采集审核拒绝。${message}`,row.item_id);
      db.prepare("UPDATE merchant_candidates SET state='rejected',reason=? WHERE id=?").run(message,id);
      audit(db,actor,"reject","merchant_candidates",id,row,{state:"rejected",reason:message});
      rejected++;
    }
    return rejected;
  });
}
