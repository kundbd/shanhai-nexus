import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { all,one,transaction } from "./db";
import { recordCoverage } from "./coverage";
import { discoverFrom,externalSalesLink,parseMerchantMetadata,type DiscoveryConfig,type Lead,type ProviderOptions } from "./discovery-providers";
import { assessMerchant,leadUrl } from "./discovery-rules";
import { pipelineForCategory,pipelines,type Pipeline } from "./taxonomy";
import { choice,now,slugValue,textValue,today,websiteUrl } from "./validation";
import { readPublicPage } from "./website-check";
import { audit,type Fields } from "./write";

export type DiscoverySource = DiscoveryConfig & {id:number;key:string;name:string;evidence_url:string;notes:string;enabled:number;
  interval_hours:number;next_run_at:string;query_cursor:number};
export type Job = {id:number;source_id:number;source_snapshot:string;state:"queued"|"running"|"ok"|"partial"|"failed";attempts:number;
  received:number;duplicates:number;candidates:number;held:number;errors:string;batch_id:number|null;token:string;available_at:string;
  started_at:string|null;finished_at:string|null};
const kinds=["brave","deepseek","page","sitemap","dataset","manual"] as const;
const accessModes=["licensed","official","leads","restricted"] as const;
const after=(ms:number)=>new Date(Date.now()+ms).toISOString();

export function saveDiscoverySource(db:DatabaseSync,input:Fields,actor:string) {
  const key=slugValue(input.key);
  const name=textValue(input.name,150,"来源名称");
  const pipeline=choice(input.pipeline,Object.keys(pipelines) as Pipeline[],"管线");
  const kind=choice(input.kind,kinds,"发现方式");
  const access=choice(input.access,accessModes,"访问与复用范围");
  const source=websiteUrl(textValue(input.url,1500,"来源网址")).url;
  const evidence=websiteUrl(textValue(input.evidence_url,1500,"许可或授权网址")).url;
  const notes=textValue(input.notes,800,"访问与复用说明");
  const interval=Number(input.interval_hours??168);
  if (!Number.isSafeInteger(interval)||interval<1||interval>720) throw new Error("运行间隔须为 1 至 720 小时。");
  const enabled=Number(pipeline!=="connections"&&(input.enabled===true||input.enabled==="1"||input.enabled===1)&&access!=="restricted"&&kind!=="manual");
  if (kind==="dataset"&&access!=="licensed"&&access!=="restricted") throw new Error("远程数据集必须记录复用许可。");
  if (kind==="sitemap"&&access!=="official"&&access!=="restricted") throw new Error("站点地图必须来自商家官网。");
  if ((kind==="brave"||kind==="deepseek")&&!["leads","restricted"].includes(access)) throw new Error("搜索 API 结果仅作发现线索。");
  return transaction(db,()=>{
    const previous=one<DiscoverySource>(db,"SELECT * FROM discovery_sources WHERE key=?",key);
    const result=one<DiscoverySource>(db,`INSERT INTO discovery_sources(key,name,pipeline,kind,access,url,evidence_url,notes,enabled,interval_hours,next_run_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET name=excluded.name,pipeline=excluded.pipeline,kind=excluded.kind,
      access=excluded.access,url=excluded.url,evidence_url=excluded.evidence_url,notes=excluded.notes,enabled=excluded.enabled,
      interval_hours=excluded.interval_hours,next_run_at=CASE WHEN discovery_sources.enabled=0 THEN excluded.next_run_at ELSE discovery_sources.next_run_at END,
      updated_at=excluded.updated_at RETURNING *`,key,name,pipeline,kind,access,source,evidence,notes,enabled,interval,now(),now())!;
    audit(db,actor,"save","discovery_sources",result.id,previous,result);
    return result;
  });
}
export function discoverySources(db:DatabaseSync) {
  return all<DiscoverySource>(db,"SELECT * FROM discovery_sources ORDER BY enabled DESC,id");
}
export function discoveryJobs(db:DatabaseSync,limit=60) {
  return all<Job & {source_name:string}>(db,`SELECT j.*,json_extract(j.source_snapshot,'$.name') source_name FROM discovery_jobs j
    ORDER BY j.id DESC LIMIT ?`,limit);
}
function insertJob(db:DatabaseSync,source:DiscoverySource) {
  return one<{id:number}>(db,`INSERT OR IGNORE INTO discovery_jobs(source_id,source_snapshot,state,available_at)
    VALUES (?,?,'queued',?) RETURNING id`,source.id,JSON.stringify(source),now())?.id ??
    one<{id:number}>(db,"SELECT id FROM discovery_jobs WHERE source_id=? AND state IN ('queued','running')",source.id)!.id;
}
export function queueDiscovery(db:DatabaseSync,id:number,actor:string,manual=false) {
  return transaction(db,()=>{
    const source=one<DiscoverySource>(db,"SELECT * FROM discovery_sources WHERE id=?",id);
    if (!source || source.pipeline==="connections" || source.access==="restricted" || (source.kind==="manual"&&!manual)) throw new Error("此来源不可自动入队。");
    const job=insertJob(db,source);
    audit(db,actor,"enqueue","discovery_jobs",job,null,{source:id});
    return job;
  });
}
export function retryDiscovery(db:DatabaseSync,id:number,actor:string) {
  const job=one<Job>(db,"SELECT * FROM discovery_jobs WHERE id=?",id);
  if (!job||!["failed","partial"].includes(job.state)) throw new Error("请选择失败或部分完成的任务。");
  return queueDiscovery(db,job.source_id,actor);
}
export function queueDue(db:DatabaseSync) {
  return transaction(db,()=>{
    const ready=all<DiscoverySource>(db,`SELECT * FROM discovery_sources WHERE enabled=1 AND pipeline<>'connections' AND access<>'restricted'
      AND kind<>'manual' AND next_run_at<=? ORDER BY CASE pipeline WHEN 'ai-retail' THEN 0
      WHEN 'payments' THEN 2 WHEN 'ai-relay' THEN 3 ELSE 4 END,next_run_at LIMIT 25`,now());
    for (const source of ready) {
      insertJob(db,source);
      db.prepare("UPDATE discovery_sources SET next_run_at=? WHERE id=?").run(after(source.interval_hours*3_600_000),source.id);
    }
    return ready.length;
  });
}

type Hit = {url:string;domain:string;registrable:string;evidence:string;query:string;decision:"candidate"|"held"|"known"|"duplicate";reason:string};
type Row = {url:string;name:string;category:string;source_url:string;source_title:string;website_language:string;basis:"basic"|"official";source_kind:"official"|"pending"};
type RunOptions=Omit<ProviderOptions,"reserveDeepSeek"> & {jobId?:number;maxChecks?:number;actor?:string};

export function deepSeekSearchUsage(db:DatabaseSync) {
  const day=now().slice(0,10);
  const configured=process.env.DEEPSEEK_DISCOVERY_DAILY_LIMIT??"5";
  const limit=/^(0|[1-9]\d?|100)$/.test(configured)?Number(configured):0;
  const used=one<{requests:number}>(db,"SELECT requests FROM deepseek_search_usage WHERE day=?",day)?.requests??0;
  return {day,limit,used};
}

export function reserveDeepSeekSearch(db:DatabaseSync) {
  const {day,limit}=deepSeekSearchUsage(db);
  if (!limit) throw new Error("DeepSeek Search 每日请求额度已关闭或配置无效");
  const reservation=one(db,`INSERT INTO deepseek_search_usage(day,requests) VALUES (?,1)
    ON CONFLICT(day) DO UPDATE SET requests=requests+1 WHERE requests<? RETURNING requests`,day,limit);
  if (!reservation) throw new Error("DeepSeek Search 今日请求额度已用完（UTC）");
}

export async function runDiscovery(db:DatabaseSync,options:RunOptions={}) {
  const token=randomUUID();
  const job=transaction(db,()=>{
    db.prepare(`UPDATE discovery_jobs SET state='queued',token=NULL,available_at=? WHERE state='running'
      AND started_at<? AND attempts<3`).run(now(),after(-30*60_000));
    db.prepare(`UPDATE discovery_jobs SET state='failed',token=NULL,finished_at=?,errors='["运行租约到期"]'
      WHERE state='running' AND started_at<? AND attempts>=3`).run(now(),after(-30*60_000));
    return one<Job>(db,`UPDATE discovery_jobs SET state='running',attempts=attempts+1,started_at=?,token=? WHERE id=(
      SELECT id FROM discovery_jobs WHERE state='queued' AND available_at<=? AND attempts<3 AND (? IS NULL OR id=?)
      AND (?=1 OR json_extract(source_snapshot,'$.kind')<>'manual') ORDER BY id LIMIT 1) RETURNING *`,
      now(),token,now(),options.jobId??null,options.jobId??null,options.manual?.length?1:0);
  });
  if (!job) return null;
  const source=JSON.parse(job.source_snapshot) as DiscoverySource;
  const hits:Hit[]=[];
  const rows:Row[]=[];
  const errors:string[]=[];
  let received=0;
  let nextCursor:number|undefined;
  try {
    if (!sourceApplicable(db,source)) throw new Error("来源配置已调整，重新提交任务后再扫描");
    const result=await discoverFrom({...source,queryCursor:source.query_cursor},{...options,reserveDeepSeek:()=>reserveDeepSeekSearch(db)});
    nextCursor=result.nextCursor;
    errors.push(...result.errors);
    received=result.leads.length;
    const seen=new Set<string>();
    const pending:{hit:Hit;lead:Lead;homepage:string}[]=[];
    for (const lead of result.leads) {
      try {
        const target=leadUrl(lead.url);
        const evidence=lead.evidence?websiteUrl(lead.evidence).url:source.url;
        const hit:Hit={url:target.url,domain:target.domain,registrable:target.registrable,evidence,query:lead.query?.slice(0,160)??"",
          decision:"held",reason:"待确认"};
        hits.push(hit);
        const key=source.kind==="sitemap"?target.url:target.registrable;
        if (seen.has(key)) {hit.decision="duplicate";hit.reason="同一任务的重复域名或页面";continue;}
        seen.add(key);
        if (one(db,"SELECT 1 FROM site_domains WHERE registrable=? UNION ALL SELECT 1 FROM import_items WHERE registrable=? AND state IN ('ready','approved','published') LIMIT 1",
          target.registrable,target.registrable)) {hit.decision="known";hit.reason="注册域已有档案或有效候选";continue;}
        pending.push({hit,lead,homepage:target.homepage});
      } catch (error) {
        const reason=error instanceof Error?error.message:"网址不可用";
        if (!errors.includes(reason)) errors.push(reason);
      }
    }
    const max=Math.min(options.maxChecks??90,500);
    const read=options.read??readPublicPage;
    const queue=pending.slice(0,max);
    const sitemapAccepted=new Set<string>();
    for (const {hit} of pending.slice(max)) hit.reason="本次查验额度已用完";
    // A sitemap is processed serially so one merchant never gets concurrent requests.
    await Promise.all(Array.from({length:Math.min(source.kind==="sitemap"?1:6,queue.length)},async()=>{
      for (let entry=queue.shift();entry;entry=queue.shift()) {
        const {hit,lead,homepage}=entry;
        try {
          if (sitemapAccepted.has(hit.registrable)) {hit.decision="duplicate";hit.reason="该商家已有公开证据";continue;}
          const licensed=source.access==="licensed" && lead.name && lead.category && pipelineForCategory(lead.category)===source.pipeline;
          const proof=licensed?null:await read(hit.url);
          if (proof && !/html/i.test(proof.contentType)) {hit.reason="页面未返回可用于身份识别的 HTML";continue;}
          const external=proof?externalSalesLink(proof.body,proof.url):"";
          if (external) {hit.reason=`下单入口指向另一个注册域 (${external})，商家主体待确认`;continue;}
          const assessment=proof?assessMerchant(source.pipeline,parseMerchantMetadata(proof.body)):null;
          if (!licensed&&!assessment?.accepted) {hit.reason=assessment?.reason??"缺少官网证据";continue;}
          if (source.kind==="sitemap") sitemapAccepted.add(hit.registrable);
          const row:Row={url:homepage,name:licensed?lead.name!:assessment!.name!,category:licensed?lead.category!:assessment!.category!,
            source_url:licensed?hit.evidence:proof!.url,source_title:licensed?source.name:"公开官网核验入口",
            website_language:assessment?.language??"",basis:"basic",source_kind:licensed?"pending":"official"};
          rows.push(row);
          hit.decision="candidate";
          hit.reason=licensed?"授权名称和公开域名，待基础审核":"官网公开元数据匹配业务，待编辑复核";
        } catch (error) { hit.reason=error instanceof Error?error.message.slice(0,180):"官网检查未完成"; }
      }
    }));
  } catch (error) {errors.push(error instanceof Error?error.message:"该来源未完成");}
  const actor=options.actor??"discovery-worker";
  return transaction(db,()=>{
    if (!one(db,"SELECT 1 FROM discovery_jobs WHERE id=? AND token=? AND state='running'",job.id,token)) return null;
    if (!sourceApplicable(db,source)) {
      db.prepare("UPDATE discovery_jobs SET state='failed',finished_at=?,token=NULL,errors=? WHERE id=?")
        .run(now(),JSON.stringify(["来源配置已变更，未保存扫描结果"]),job.id);
      return one<Job>(db,"SELECT * FROM discovery_jobs WHERE id=?",job.id);
    }
    const append=db.prepare(`INSERT OR IGNORE INTO discovery_hits(job_id,url,domain,registrable,evidence_url,query,decision,reason)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (const hit of hits) append.run(job.id,hit.url,hit.domain,hit.registrable,hit.evidence,hit.query,hit.decision,hit.reason);
    if (nextCursor!==undefined) db.prepare("UPDATE discovery_sources SET query_cursor=? WHERE id=?").run(nextCursor,source.id);
    let batch:number|null=null;
    if (rows.length) {
      batch=recordCoverage(db,{pipeline:source.pipeline,source_name:source.name,source_url:source.url,evidence_url:source.evidence_url,
        access:source.access==="licensed"?"licensed":"official",reason:source.notes},JSON.stringify(rows.map(row=>({...row,snapshot_at:today()}))),"json",actor,true).batch_id;
    }
    const actual=batch?one<{n:number}>(db,"SELECT count(*) n FROM import_items WHERE batch_id=? AND state='ready'",batch)!.n:0;
    const held=hits.filter(hit=>hit.decision==="held").length;
    const duplicates=hits.filter(hit=>["duplicate","known"].includes(hit.decision)).length;
    const ignored=Math.max(0,received-hits.length);
    const fatal=errors.length>0&&!hits.length;
    const state=fatal?"failed":errors.length?"partial":"ok";
    const transient=fatal&&errors.some(error=>/HTTP (?:408|429|5\d\d)|timeout|timed out|aborted|fetch failed|ECONNRESET|EAI_AGAIN|请求超时|网络请求失败/i.test(error));
    const retry=transient&&job.attempts<3;
    db.prepare(`UPDATE discovery_jobs SET state=?,available_at=?,finished_at=?,token=NULL,received=?,duplicates=?,candidates=?,held=?,errors=?,batch_id=?
      WHERE id=? AND token=?`).run(retry?"queued":state,retry?after(job.attempts*5*60_000):now(),now(),received,duplicates+rows.length-actual,actual,
      held+ignored,JSON.stringify(errors.slice(0,50)),batch,job.id,token);
    return one<Job>(db,"SELECT * FROM discovery_jobs WHERE id=?",job.id);
  });
}

function sourceApplicable(db:DatabaseSync,source:DiscoverySource) {
  const current=one<DiscoverySource>(db,"SELECT * FROM discovery_sources WHERE id=?",source.id);
  return current&&current.pipeline!=="connections"&&current.access!=="restricted"&&current.access===source.access&&current.url===source.url&&
    current.evidence_url===source.evidence_url&&current.kind===source.kind&&current.pipeline===source.pipeline;
}
