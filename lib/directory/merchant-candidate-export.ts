import { closeSync,openSync,unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { all,one,transaction } from "./db";
import { deepSeekSearchReference } from "./deepseek-search";
import { now,websiteUrl } from "./validation";

function publicReference(value:string) {
  try {
    const url=new URL(websiteUrl(value).url);
    if (/\/(?:invite|aff|refer|referral|auth|checkout|login|redeem|session|subscribe|subscription|token|account)(?:\/|$)/i.test(url.pathname)) return url.origin+"/";
    url.search="";
    return url.href;
  } catch { return ""; }
}

type Sighting={source:string;candidate_id:number|null;url:string;evidence:string;name_hint:string;discovered_at:string;reason:string};

export function exportMerchantCandidates(db:DatabaseSync,campaign:number,filename:string) {
  const run=one<{id:number;name:string}>(db,"SELECT id,name FROM merchant_campaigns WHERE id=?",campaign);
  if (!run||!filename) throw new Error("需要有效的任务编号和新的 SQLite 输出文件。");
  const path=resolve(filename);
  closeSync(openSync(path,"wx",0o600));
  try {
    using file=new DatabaseSync(path);
    file.exec(`CREATE TABLE campaign(id INTEGER PRIMARY KEY,name TEXT NOT NULL,exported_at TEXT NOT NULL) STRICT;
      CREATE TABLE candidates(id INTEGER PRIMARY KEY,domain TEXT NOT NULL UNIQUE,pipeline TEXT NOT NULL,state TEXT NOT NULL,
        checked_at TEXT,reason TEXT NOT NULL,name TEXT,category TEXT,review_state TEXT,seen_previously INTEGER NOT NULL) STRICT;
      CREATE TABLE sightings(id INTEGER PRIMARY KEY,source TEXT NOT NULL,candidate_id INTEGER REFERENCES candidates(id),
        url TEXT NOT NULL,evidence TEXT NOT NULL,name_hint TEXT NOT NULL,discovered_at TEXT NOT NULL,reason TEXT NOT NULL) STRICT;
      CREATE INDEX sightings_candidate ON sightings(candidate_id,discovered_at);
      CREATE TABLE source_runs(id INTEGER PRIMARY KEY,source TEXT NOT NULL,source_url TEXT NOT NULL,license_url TEXT NOT NULL,
        authorization TEXT NOT NULL,notes TEXT NOT NULL,adapter TEXT NOT NULL,created_at TEXT NOT NULL,state TEXT NOT NULL,returned INTEGER NOT NULL,error TEXT NOT NULL) STRICT;
      CREATE TABLE verification_attempts(id INTEGER PRIMARY KEY,candidate_id INTEGER NOT NULL REFERENCES candidates(id),
        checked_at TEXT NOT NULL,outcome TEXT NOT NULL,reason TEXT NOT NULL,elapsed_ms INTEGER NOT NULL,proof_url TEXT) STRICT;`);
    return transaction(file,()=>{
      file.prepare("INSERT INTO campaign VALUES (?,?,?)").run(run.id,run.name,now());
      const candidates=file.prepare("INSERT INTO candidates VALUES (?,?,?,?,?,?,?,?,?,?)");
      const rows=db.prepare(`SELECT c.id,c.registrable,c.pipeline,c.state,c.checked_at,c.reason,json_extract(c.details,'$.name') name,
        json_extract(c.details,'$.category') category,i.state review_state,
        EXISTS(SELECT 1 FROM merchant_candidates p WHERE p.registrable=c.registrable AND p.campaign_id<c.campaign_id) seen_previously
        FROM merchant_candidates c LEFT JOIN import_items i ON i.id=c.item_id WHERE c.campaign_id=? ORDER BY c.id`).all(campaign);
      for (const r of rows) candidates.run(r.id,r.registrable,r.pipeline,r.state,r.checked_at,r.reason,r.name,r.category,r.review_state,r.seen_previously);
      const sightings=file.prepare("INSERT INTO sightings(source,candidate_id,url,evidence,name_hint,discovered_at,reason) VALUES (?,?,?,?,?,?,?)");
      for (const r of all<Sighting>(db,`SELECT 'DeepSeek Search' source,u.candidate_id,u.url,? evidence,'' name_hint,r.started_at discovered_at,u.filter_reason reason
        FROM merchant_urls u JOIN merchant_requests r ON r.id=u.request_id WHERE r.campaign_id=?
        UNION ALL SELECT json_extract(r.source_snapshot,'$.name'),l.candidate_id,l.url,l.evidence_url,l.name_hint,r.created_at,l.filter_reason
        FROM merchant_source_links l JOIN merchant_source_runs r ON r.id=l.run_id WHERE r.campaign_id=?`,deepSeekSearchReference,campaign,campaign)) {
        const url=publicReference(r.url);
        if (url) sightings.run(r.source,r.candidate_id,url,publicReference(r.evidence),r.name_hint,r.discovered_at,r.reason);
      }
      const sources=file.prepare("INSERT INTO source_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)");
      for (const r of db.prepare(`SELECT id,json_extract(source_snapshot,'$.name') name,json_extract(source_snapshot,'$.url') url,
        json_extract(source_snapshot,'$.evidence_url') license,json_extract(source_snapshot,'$.access') access,json_extract(source_snapshot,'$.notes') notes,
        adapter,created_at,state,returned,error FROM merchant_source_runs WHERE campaign_id=?`).all(campaign)) {
        sources.run(r.id,r.name,publicReference(String(r.url)),publicReference(String(r.license)),r.access,r.notes,r.adapter,r.created_at,r.state,r.returned,r.error);
      }
      const attempts=file.prepare("INSERT INTO verification_attempts VALUES (?,?,?,?,?,?,?)");
      for (const r of db.prepare(`SELECT a.* FROM merchant_verification_attempts a
        JOIN merchant_candidates c ON c.id=a.candidate_id WHERE c.campaign_id=?`).all(campaign)) {
        attempts.run(r.id,r.candidate_id,r.checked_at,r.outcome,r.reason,r.elapsed_ms,r.proof_url?publicReference(String(r.proof_url)):null);
      }
      if (all(file,"PRAGMA foreign_key_check").length) throw new Error("候选档案来源关联校验失败。");
      return {path,candidates:rows.length,sightings:one<{n:number}>(file,"SELECT count(*) n FROM sightings")!.n};
    });
  } catch (error) {
    unlinkSync(path);
    throw error;
  }
}
