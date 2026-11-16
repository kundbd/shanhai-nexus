import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { all,directory,one,transaction } from "./db";
import { currentPublicQuotes } from "./price-board";

export const directoryRefreshInterval=5*60*60_000;
const leaseDuration=90_000;
const historyDays=7;
type Run={id:number;started_at:string;finished_at:string|null;lease_until:string;token:string|null;targets:number;search_state:string;
  search_query:string;search_urls:string;search_reserved_milli:number;search_billable_milli:number;search_error:string;
  rate_state:string;rate_day:string|null;rate_error:string;last_error:string;reachable:number;restricted:number;unconfirmed:number;quotes_checked:number;quotes_changed:number};
export type RefreshTarget={id:number;kind:"site"|"domain"|"price";site_id:number|null;domain:string|null;url:string};
export type RefreshLease={run:Run;token:string};
const iso=(value:number)=>new Date(value).toISOString();

function addTargets(db:DatabaseSync,run:number) {
  const pricing=new Map(currentPublicQuotes(db).filter(row=>row.source_kind==="official").map(row=>[JSON.stringify([row.site_id,row.source_url]),row]));
  const add=db.prepare("INSERT INTO directory_refresh_targets(run_id,kind,site_id,url) VALUES (?,'price',?,?)");
  for (const row of pricing.values()) add.run(run,row.site_id,row.source_url);
  db.prepare(`INSERT INTO directory_refresh_targets(run_id,kind,site_id,url)
    SELECT ?,'site',s.id,s.website FROM sites s WHERE s.publication='published' AND s.lifecycle<>'closed'
      AND NOT EXISTS (SELECT 1 FROM merchant_storefronts sf WHERE sf.site_id=s.id AND sf.url=s.website
        AND (sf.host IN ('16688.com.cn','catfk.com') OR sf.source_url GLOB 'https://ai.pricememo.cn/data/v1/snapshots/*.json'))
    ORDER BY s.id`).run(run);
  db.prepare("UPDATE directory_refresh_runs SET targets=(SELECT count(*) FROM directory_refresh_targets WHERE run_id=?) WHERE id=?").run(run,run);
}

export function claimRefresh(db:DatabaseSync,clock:number):RefreshLease|null {
  return transaction(db,()=>{
    const time=iso(clock);
    const previous=one<Run>(db,"SELECT * FROM directory_refresh_runs ORDER BY id DESC LIMIT 1");
    let id=previous?.id;
    if (!previous||previous.finished_at) {
      if (previous&&clock<Date.parse(previous.started_at)+directoryRefreshInterval) return null;
      id=Number(db.prepare("INSERT INTO directory_refresh_runs(started_at) VALUES (?)").run(time).lastInsertRowid);
      addTargets(db,id);
      db.prepare(`DELETE FROM directory_refresh_targets WHERE run_id IN (SELECT id FROM directory_refresh_runs WHERE finished_at<?)`)
        .run(iso(clock-historyDays*86_400_000));
    } else if (previous.token&&previous.lease_until>time) return null;
    const token=randomUUID();
    const run=one<Run>(db,`UPDATE directory_refresh_runs SET token=?,lease_until=?,last_error='',
      search_error=CASE WHEN search_state='reserved' THEN '中断前已占用额度，本轮保留原请求' ELSE search_error END,
      search_state=CASE WHEN search_state='reserved' THEN 'uncertain' ELSE search_state END
      WHERE id=? RETURNING *`,token,iso(clock+leaseDuration),id!)!;
    return {run,token};
  });
}

export function ownsRefresh(db:DatabaseSync,{run,token}:RefreshLease) {
  return !!one(db,"SELECT 1 FROM directory_refresh_runs WHERE id=? AND token=? AND finished_at IS NULL",run.id,token);
}

export function renewRefresh(db:DatabaseSync,{run,token}:RefreshLease,clock:number) {
  return Number(db.prepare("UPDATE directory_refresh_runs SET lease_until=? WHERE id=? AND token=? AND finished_at IS NULL")
    .run(iso(clock+leaseDuration),run.id,token).changes)>0;
}

export function finishRefreshBatch(db:DatabaseSync,{run,token}:RefreshLease,clock:number,error="") {
  return transaction(db,()=>{
    if (!ownsRefresh(db,{run,token})) return;
    const progress=refreshProgress(db,run.id);
    const complete=progress.done===run.targets&&progress.ratesDone&&progress.searchDone;
    db.prepare(`UPDATE directory_refresh_runs SET token=NULL,lease_until='',finished_at=?,reachable=?,restricted=?,unconfirmed=?,
      quotes_checked=?,quotes_changed=?,last_error=? WHERE id=? AND token=?`)
      .run(complete?iso(clock):null,progress.reachable,progress.restricted,progress.unconfirmed,progress.quotes_checked,progress.quotes_changed,error,run.id,token);
  });
}

export function pendingRefreshTargets(db:DatabaseSync,run:number,limit:number) {
  return all<RefreshTarget>(db,`SELECT id,kind,site_id,domain,url FROM directory_refresh_targets WHERE run_id=? AND checked_at IS NULL ORDER BY id LIMIT ?`,run,limit);
}

function refreshProgress(db:DatabaseSync,run:number) {
  const data=one<{done:number;reachable:number;restricted:number;unconfirmed:number;quotes_checked:number;quotes_changed:number}>(db,`SELECT count(checked_at) done,
    count(CASE WHEN result='reachable' THEN 1 END) reachable,count(CASE WHEN result IN ('restricted','skipped') THEN 1 END) restricted,
    count(CASE WHEN result IN ('unreachable','inconclusive','needs_evidence') THEN 1 END) unconfirmed,
    coalesce(sum(quotes_checked),0) quotes_checked,coalesce(sum(quotes_changed),0) quotes_changed FROM directory_refresh_targets WHERE run_id=?`,run)!;
  const search=one<{search_state:string;rate_state:string}>(db,"SELECT search_state,rate_state FROM directory_refresh_runs WHERE id=?",run)!;
  return {...data,searchDone:!['pending','reserved'].includes(search.search_state),ratesDone:search.rate_state!=="pending"};
}

export function directoryRefreshStatus(db=directory()) {
  const latest=one<Run>(db,"SELECT * FROM directory_refresh_runs ORDER BY id DESC LIMIT 1");
  const completed=one<Run>(db,"SELECT * FROM directory_refresh_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1");
  if (!latest) return {latest:null,completed:null,nextDue:null};
  const withProgress=(run:Run)=>({id:run.id,startedAt:run.started_at,finishedAt:run.finished_at,targets:run.targets,
    done:run.finished_at?run.targets:refreshProgress(db,run.id).done,
    reachable:run.reachable,restricted:run.restricted,unconfirmed:run.unconfirmed,quotesChecked:run.quotes_checked,quotesChanged:run.quotes_changed,
    search:run.search_state,searchQuery:run.search_query,reservedMilli:run.search_reserved_milli,billableMilli:run.search_billable_milli,searchError:run.search_error,
    rateDay:run.rate_day,rateError:run.rate_error,error:run.last_error});
  return {latest:withProgress(latest),completed:completed?withProgress(completed):null,nextDue:iso(Date.parse(latest.started_at)+directoryRefreshInterval)};
}
