import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { all,one,transaction } from "./db";
import { approvalIssue,candidate,createImport,parseImport,type Format } from "./imports";
import type { ImportItem } from "./types";
import { choice,now,textValue,today,websiteUrl } from "./validation";

import { pipelineForCategory,pipelines,type Pipeline } from "./taxonomy";
type Access="licensed"|"official"|"submission"|"restricted";
export type CoverageRun={ id:number; pipeline:Pipeline; source_name:string; source_url:string; evidence_url:string; access:Access;
  advertised:number|null; discovered:number; blocked:number|null; reason:string; collected_at:string; batch_id:number|null;
  unique_hosts:number; duplicates:number; replays:number; pending:number; eligible:number; approved:number; published:number; failed:number };
type Intake={ pipeline:unknown; source_name:unknown; source_url:unknown; evidence_url:unknown; access:unknown;
  advertised?:unknown; blocked?:unknown; reason?:unknown };
function count(value:unknown) {
  if (value==null || value==="") return null;
  const number=Number(value);
  if (!Number.isSafeInteger(number)||number<0||number>100_000_000) throw new Error("来源数量须为有效的非负整数。");
  return number;
}
export function recordCoverage(db:DatabaseSync,input:Intake,raw:string,format:Format,actor:string,withinTransaction=false) {
  const pipeline=choice(input.pipeline,Object.keys(pipelines) as Pipeline[],"采集管线");
  const access=choice(input.access,["licensed","official","submission","restricted"],"使用依据");
  const sourceName=textValue(input.source_name,180,"来源名称");
  const source=websiteUrl(textValue(input.source_url,1500,"来源网址")).url;
  const evidence=websiteUrl(textValue(input.evidence_url,1500,"许可、提交记录或官网证据")).url;
  const advertised=count(input.advertised);
  const blocked=count(input.blocked);
  const reason=textValue(input.reason,700,"记录说明",access==="restricted");
  if (access==="restricted" && raw.trim()) throw new Error("受限来源只登记来源审计，不能导入条目。");
  if (access!=="restricted" && blocked!==null && blocked!==0) throw new Error("受限数量请单独登记到对应来源的受限审计。");
  const rows=access==="restricted"?[]:parseImport(raw,format);
  const fingerprint=createHash("sha256").update(JSON.stringify([pipeline,access,source,evidence,sourceName,advertised,blocked,reason,rows])).digest("hex");
  const write=()=>{
    const existing=one<{id:number;batch_id:number|null}>(db,"SELECT id,batch_id FROM coverage_runs WHERE fingerprint=?",fingerprint);
    if (existing) return {id:existing.id,batch_id:existing.batch_id};
    const records=rows.map(row=>{
      const fields=typeof row==="string"?{url:row}:row as Record<string,unknown>|null;
      if (!fields||Array.isArray(fields)||typeof fields!=="object") return row;
      const scoped={...fields, discovery_name:sourceName, source_url:fields.source_url||source, license_url:access==="licensed"?evidence:null,
        snapshot_at:fields.snapshot_at||today(), basis:access==="official"&&fields.basis!=="basic"?"official":"basic",
        publication_evidence:evidence, approval_key:fingerprint };
      try {
        const {data}=candidate(scoped);
        if (pipelineForCategory(data.category)!==pipeline) return {...scoped,coverage_error:"条目分类不在所选管线，请更正后重试。"};
      } catch { /* The importer retains invalid rows for correction. */ }
      return scoped;
    });
    const batch=records.length?createImport(db,JSON.stringify(records),"json",actor,true):null;
    const id=Number(db.prepare(`INSERT INTO coverage_runs(pipeline,source_name,source_url,evidence_url,access,advertised,discovered,
      blocked,reason,collected_at,fingerprint,batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(pipeline,sourceName,source,evidence,access,advertised,rows.length,blocked,reason,now(),fingerprint,batch).lastInsertRowid);
    return {id,batch_id:batch};
  };
  return withinTransaction?write():transaction(db,write);
}
export function coverageRuns(db:DatabaseSync,pipeline?:Pipeline,limit=500) {
  const runs=all<CoverageRun>(db,`SELECT r.*,
      count(DISTINCT CASE WHEN i.state IN ('ready','approved','published') THEN i.domain END) unique_hosts,
      count(CASE WHEN i.state='duplicate' THEN 1 END) duplicates,
      coalesce((SELECT json_extract(l.after_json,'$.skipped')+json_extract(l.after_json,'$.refreshed')
        FROM audit_log l WHERE l.entity='import_batches' AND l.entity_id=CAST(r.batch_id AS TEXT) AND l.action='preview' ORDER BY l.id DESC LIMIT 1),0) replays,
      count(CASE WHEN i.state='ready' THEN 1 END) pending,
      0 eligible,
      count(CASE WHEN i.state='approved' THEN 1 END) approved,
      count(CASE WHEN i.state='published' THEN 1 END) published,
      count(CASE WHEN i.state='failed' THEN 1 END) failed
    FROM coverage_runs r LEFT JOIN import_items i ON i.batch_id=r.batch_id
    WHERE (? IS NULL OR r.pipeline=?) GROUP BY r.id ORDER BY r.id DESC LIMIT ?`,pipeline??null,pipeline??null,limit);
  const byBatch=new Map(runs.filter(run=>run.batch_id!==null).map(run=>[run.batch_id,run]));
  if (!byBatch.size) return runs;
  for (const row of all<ImportItem>(db,`SELECT i.* FROM import_items i
    JOIN coverage_runs r ON r.batch_id=i.batch_id WHERE i.state='ready' AND r.access IN ('licensed','official','submission')
    AND (? IS NULL OR r.pipeline=?)`,pipeline??null,pipeline??null)) {
    const run=byBatch.get(row.batch_id);
    if (run && !approvalIssue(db,row)) run.eligible++;
  }
  return runs;
}

export function intakeSubmission(db:DatabaseSync,id:number,publicSource:string,actor:string) {
  const row=one<{merchant_name:string|null;merchant_category:string|null;url:string|null;publication_consent:number;intake_run:number|null}>(db,
    "SELECT * FROM submissions WHERE id=? AND kind='site'",id);
  if (!row?.publication_consent||!row.merchant_name||!row.merchant_category||!row.url) throw new Error("没有可核验的商家授权投稿。");
  if (row.intake_run) {
    const existing=one<{id:number;batch_id:number|null}>(db,"SELECT id,batch_id FROM coverage_runs WHERE id=?",row.intake_run)!;
    return {id:existing.id,batch_id:existing.batch_id};
  }
  const pipeline=pipelineForCategory(row.merchant_category);
  const link=websiteUrl(publicSource).url;
  if (websiteUrl(link).registrable!==websiteUrl(row.url).registrable||!pipeline) throw new Error("请提交同主体公开官网证据。");
  const result=recordCoverage(db,{pipeline,access:"submission",source_name:`授权商家投稿 #${id}`,source_url:link,evidence_url:link,
    reason:"编辑已查验商家授权与公开官网。"},
  JSON.stringify([{name:row.merchant_name,url:row.url,category:row.merchant_category,source_url:link,source_title:"商家公开官网"}]),"json",actor);
  db.prepare("UPDATE submissions SET intake_run=?,moderation='accepted' WHERE id=?").run(result.id,id);
  return result;
}
export function coverageTotals(runs:CoverageRun[]) {
  return Object.keys(pipelines).map(key=>{
    const group=runs.filter(run=>run.pipeline===key);
    return {pipeline:key, discovered:group.reduce((n,r)=>n+r.discovered,0),
      deduplicated:group.reduce((n,r)=>n+r.unique_hosts,0), duplicates:group.reduce((n,r)=>n+r.duplicates+r.replays,0),
      restricted:group.reduce((n,r)=>n+(r.blocked??0),0), unknown_restricted_sources:group.filter(r=>r.access==="restricted" && r.blocked===null).length,
      publishable:group.reduce((n,r)=>n+r.eligible+r.approved+r.published,0),
      pending:group.reduce((n,r)=>n+r.pending,0), published:group.reduce((n,r)=>n+r.published,0), failed:group.reduce((n,r)=>n+r.failed,0)};
  });
}
