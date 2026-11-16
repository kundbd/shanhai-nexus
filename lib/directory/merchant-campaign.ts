import type { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { all,one,transaction } from "./db";
import { deepSeekProxyRoute,deepSeekSearchReference,searchDeepSeek } from "./deepseek-search";
import { merchantSearchLead } from "./discovery-rules";
import { campaignSeeds,type QuerySeed } from "./merchant-queries";
import type { Pipeline } from "./taxonomy";
import { now,textValue } from "./validation";
import { audit } from "./write";

export type MerchantSearchProvider={key:string;reference:string;unitMilli:number;intervalMs:number;
  search:(query:string)=>Promise<{urls:string[];returned:number}>};
export const deepSeekMerchantProvider:MerchantSearchProvider={key:"deepseek",reference:deepSeekSearchReference,unitMilli:5,intervalMs:350,
  search:query=>searchDeepSeek(query,50)};

type Campaign={id:number;name:string;state:"running"|"paused"|"blocked";budget_milli:number;pause_reason:string;created_at:string};
type Query={id:number;campaign_id:number;pipeline:Pipeline;query:string};
const forward=(milliseconds:number)=>new Date(Date.now()+milliseconds).toISOString();

export function addMerchantQueries(db:DatabaseSync,campaign:number,seeds:QuerySeed[],provider=deepSeekMerchantProvider.key) {
  const insert=db.prepare(`INSERT OR IGNORE INTO merchant_queries(campaign_id,provider,pipeline,family,query,priority)
    SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM discovery_hits WHERE query=?)`);
  for (const seed of seeds) insert.run(campaign,provider,seed.pipeline,seed.family,seed.query,seed.priority,seed.query);
}

export function createMerchantCampaign(db:DatabaseSync,name:string,budgetMilli:number,actor:string,seeds=campaignSeeds()) {
  if (!Number.isSafeInteger(budgetMilli)||budgetMilli<5||budgetMilli>10_000||budgetMilli%5!==0) throw new Error("采集预算须为 0.005 至 10 元，按 0.005 元递增。");
  return transaction(db,()=>{
    const row=one<Campaign>(db,"INSERT INTO merchant_campaigns(name,budget_milli,created_at) VALUES (?,?,?) RETURNING *",
      textValue(name,100,"采集任务名称"),budgetMilli,now())!;
    addMerchantQueries(db,row.id,seeds);
    audit(db,actor,"create","merchant_campaigns",row.id,null,row);
    return row;
  });
}

export function controlMerchantCampaign(db:DatabaseSync,id:number,state:"paused"|"running",actor:string) {
  return transaction(db,()=>{
    const before=one<Campaign>(db,"SELECT * FROM merchant_campaigns WHERE id=?",id);
    if (!before) throw new Error("找不到这个采集任务。");
    const row=one<Campaign>(db,"UPDATE merchant_campaigns SET state=?,pause_reason='' WHERE id=? RETURNING *",state,id)!;
    audit(db,actor,state,"merchant_campaigns",id,before,row);
    return row;
  });
}

function claimQuery(db:DatabaseSync,id:number,pipeline:Pipeline|undefined,provider:MerchantSearchProvider) {
  return transaction(db,()=>{
    const current=one<Campaign>(db,"SELECT * FROM merchant_campaigns WHERE id=?",id);
    if (!current || current.state!=="running") return null;
    const moment=now();
    db.prepare(`UPDATE merchant_requests SET state='uncertain',error='进程中断，保守计入预算',finished_at=? WHERE state='reserved'
      AND query_id IN (SELECT id FROM merchant_queries WHERE campaign_id=? AND state='running' AND lease_until<=?)`).run(moment,id,moment);
    db.prepare(`UPDATE merchant_queries AS q SET state=CASE WHEN (SELECT count(*) FROM merchant_requests WHERE query_id=q.id)>=3 THEN 'failed' ELSE 'queued' END,
      lease_until='' WHERE q.campaign_id=? AND q.state='running' AND q.lease_until<=?`).run(id,moment);
    const usage=one<{spent:number}>(db,"SELECT coalesce(sum(unit_milli),0) spent FROM merchant_requests WHERE campaign_id=?",id)!;
    if (usage.spent+provider.unitMilli>current.budget_milli) {
      db.prepare("UPDATE merchant_campaigns SET state='blocked',pause_reason='已达到保守费用上限' WHERE id=?").run(id);
      return null;
    }
    const inFlight=one<{n:number}>(db,"SELECT count(*) n FROM merchant_requests WHERE state='reserved' AND started_at>?",forward(-120_000))!.n;
    if (inFlight>=4) return {wait:350};
    const last=one<{started_at:string}>(db,"SELECT started_at FROM merchant_requests ORDER BY id DESC LIMIT 1");
    const wait=last?Math.max(0,provider.intervalMs-(Date.now()-Date.parse(last.started_at))):0;
    if (wait) return {wait};
    const query=one<Query>(db,`WITH yields AS (
      SELECT q.family,count(r.id) completed,avg(r.added) mean,sum((SELECT count(DISTINCT c.id) FROM merchant_urls u
        JOIN merchant_candidates c ON c.id=u.candidate_id WHERE u.request_id=r.id AND c.state='ready'
        AND u.id=(SELECT min(first.id) FROM merchant_urls first WHERE first.candidate_id=c.id))) checked
      FROM merchant_queries q JOIN merchant_requests r ON r.query_id=q.id
      WHERE q.campaign_id=? AND r.state IN ('billable','empty') GROUP BY q.family
    ) SELECT q.id,q.campaign_id,q.pipeline,q.query FROM merchant_queries q LEFT JOIN yields y ON y.family=q.family
    WHERE q.campaign_id=? AND q.provider=? AND q.state='queued' AND q.available_at<=? AND (? IS NULL OR q.pipeline=?)
    ORDER BY q.priority + CASE WHEN y.completed>=2 THEN CASE WHEN y.mean<0.5 THEN 80 ELSE -min(y.mean,12)*3 END ELSE 0 END
      -min(coalesce(y.checked,0),10)*4,q.id LIMIT 1`,
    id,id,provider.key,moment,pipeline??null,pipeline??null);
    if (!query) return null;
    db.prepare("UPDATE merchant_queries SET state='running',lease_until=? WHERE id=?").run(forward(120_000),query.id);
    const request=Number(db.prepare("INSERT INTO merchant_requests(query_id,campaign_id,unit_milli,started_at) VALUES (?,?,?,?)")
      .run(query.id,id,provider.unitMilli,moment).lastInsertRowid);
    return {query,request};
  });
}

function saveResults(db:DatabaseSync,query:Query,request:number,result:{urls:string[];returned:number}) {
  return transaction(db,()=>{
    if (!one(db,"SELECT 1 FROM merchant_requests WHERE id=? AND state='reserved'",request)) return;
    const candidate=db.prepare(`INSERT INTO merchant_candidates(campaign_id,registrable,pipeline,state) VALUES (?,?,?,?)
      ON CONFLICT(campaign_id,registrable) DO NOTHING RETURNING id`);
    const link=db.prepare("INSERT OR IGNORE INTO merchant_urls(request_id,candidate_id,url,filter_reason) VALUES (?,?,?,?)");
    let added=0;
    for (const raw of result.urls) {
      let scrubbed:URL;
      try { scrubbed=new URL(raw); } catch { continue; }
      scrubbed.search=""; scrubbed.hash="";
      try {
        const {target,rootOnly}=merchantSearchLead(scrubbed.href);
        const known=one(db,"SELECT 1 FROM site_domains WHERE registrable=?",target.registrable);
        const inserted=candidate.get(query.campaign_id,target.registrable,query.pipeline,known?"known":"queued") as {id:number}|undefined;
        const id=inserted?.id??one<{id:number}>(db,"SELECT id FROM merchant_candidates WHERE campaign_id=? AND registrable=?",query.campaign_id,target.registrable)!.id;
        if (inserted&&!known) added++;
        link.run(request,id,rootOnly?scrubbed.href:target.url,rootOnly?"账号入口仅用于定位公开首页":"");
      } catch (error) {
        const reason=error instanceof Error?error.message:"网址格式无效";
        link.run(request,null,scrubbed.href,reason);
      }
    }
    db.prepare("UPDATE merchant_requests SET state=?,returned=?,added=?,finished_at=? WHERE id=?")
      .run(result.returned?"billable":"empty",result.returned,added,now(),request);
    db.prepare("UPDATE merchant_queries SET state='done',lease_until='' WHERE id=?").run(query.id);
  });
}

function saveSearchError(db:DatabaseSync,query:Query,request:number,error:unknown) {
  const message=error instanceof Error && /^DeepSeek Search |^未设置 DEEPSEEK_API_KEY$/.test(error.message)?error.message:"搜索服务返回异常";
  return transaction(db,()=>{
    if (!one(db,"SELECT 1 FROM merchant_requests WHERE id=? AND state='reserved'",request)) return;
    const count=one<{n:number}>(db,"SELECT count(*) n FROM merchant_requests WHERE query_id=?",query.id)!.n;
    const retry=/HTTP (?:408|429|5\d\d)|超时|网络请求失败/.test(message)&&count<3;
    const blocked=/HTTP (?:401|402|403)|^未设置/.test(message);
    db.prepare("UPDATE merchant_requests SET state=?,error=?,finished_at=? WHERE id=?")
      .run(/HTTP \d{3}|^未设置/.test(message)?"failed":"uncertain",message,now(),request);
    db.prepare("UPDATE merchant_queries SET state=?,lease_until='',available_at=? WHERE id=?")
      .run(retry||blocked?"queued":"failed",forward(10_000*count),query.id);
    if (blocked) db.prepare("UPDATE merchant_campaigns SET state='blocked',pause_reason=? WHERE id=?").run(message,query.campaign_id);
  });
}

export async function searchMerchantCampaign(db:DatabaseSync,id:number,limit:number,pipeline?:Pipeline,provider=deepSeekMerchantProvider) {
  if (provider===deepSeekMerchantProvider) {
    if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new Error("未设置 DEEPSEEK_API_KEY");
    deepSeekProxyRoute();
  }
  if (!Number.isSafeInteger(limit)||limit<1||limit>2000) throw new Error("批次数量须为 1–2,000。");
  let attempts=0;
  await Promise.all(Array.from({length:Math.min(4,limit)},async()=>{
    while (attempts<limit) {
      const work=claimQuery(db,id,pipeline,provider);
      if (!work) return;
      if ("wait" in work) { await delay(work.wait);continue; }
      attempts++;
      let result;
      try { result=await provider.search(work.query.query); }
      catch (error) { saveSearchError(db,work.query,work.request,error);continue; }
      saveResults(db,work.query,work.request,result);
      if (attempts%10===0) console.error(`采集 #${id} 已发出 ${attempts} 次搜索`);
    }
  }));
  return attempts;
}

export function merchantCampaignReport(db:DatabaseSync,id:number) {
  const campaign=one<Campaign>(db,"SELECT * FROM merchant_campaigns WHERE id=?",id);
  if (!campaign) throw new Error("找不到这个采集任务。");
  return {campaign,
    uniqueQueries:one<{count:number}>(db,"SELECT count(DISTINCT query_id) count FROM merchant_requests WHERE campaign_id=?",id)!.count,
    queries:all(db,"SELECT pipeline,state,count(*) count FROM merchant_queries WHERE campaign_id=? GROUP BY pipeline,state",id),
    requests:all(db,"SELECT state,count(*) count,sum(unit_milli) reserved_milli,sum(returned) returned FROM merchant_requests WHERE campaign_id=? GROUP BY state",id),
    errors:all(db,"SELECT error,count(*) count FROM merchant_requests WHERE campaign_id=? AND error<>'' GROUP BY error",id),
    urls:one(db,`SELECT count(*) occurrences,count(DISTINCT u.url) unique_urls, count(CASE WHEN u.candidate_id IS NULL THEN 1 END) filtered
      FROM merchant_urls u JOIN merchant_requests r ON r.id=u.request_id WHERE r.campaign_id=?`,id),
    candidates:all(db,`SELECT c.pipeline,c.state,coalesce(i.state,'') review_state,count(*) count
      FROM merchant_candidates c LEFT JOIN import_items i ON i.id=c.item_id WHERE c.campaign_id=? GROUP BY c.pipeline,c.state,coalesce(i.state,'')`,id),
    reasons:all(db,"SELECT state,reason,count(*) count FROM merchant_candidates WHERE campaign_id=? AND reason<>'' GROUP BY state,reason ORDER BY count(*) DESC LIMIT 80",id),
    published:all(db,"SELECT category_slug,count(*) count FROM sites WHERE publication='published' GROUP BY category_slug ORDER BY count(*) DESC"),
  };
}

export function recoverMerchantHomepageLeads(db:DatabaseSync,id:number) {
  return transaction(db,()=>{
    const rows=all<{id:number;url:string;pipeline:Pipeline}>(db,`SELECT u.id,u.url,q.pipeline FROM merchant_urls u
      JOIN merchant_requests r ON r.id=u.request_id JOIN merchant_queries q ON q.id=r.query_id
      WHERE r.campaign_id=? AND u.candidate_id IS NULL AND u.filter_reason='跳转、下载、账户或非公开内容路径'`,id);
    let recovered=0;
    for (const row of rows) {
      let lead:ReturnType<typeof merchantSearchLead>;
      try { lead=merchantSearchLead(row.url); } catch { continue; }
      if (!lead.rootOnly) continue;
      const key=lead.target.registrable;
      const known=one(db,"SELECT 1 FROM site_domains WHERE registrable=?",key);
      db.prepare("INSERT OR IGNORE INTO merchant_candidates(campaign_id,registrable,pipeline,state) VALUES (?,?,?,?)").run(id,key,row.pipeline,known?"known":"queued");
      const candidate=one<{id:number}>(db,"SELECT id FROM merchant_candidates WHERE campaign_id=? AND registrable=?",id,key)!;
      db.prepare("UPDATE merchant_urls SET candidate_id=?,filter_reason='账号入口仅用于定位公开首页' WHERE id=?").run(candidate.id,row.id);
      recovered++;
    }
    return recovered;
  });
}

