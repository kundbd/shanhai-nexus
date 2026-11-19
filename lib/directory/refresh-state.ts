import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { all,directory,one,transaction } from "./db";
import { refreshablePublicQuotes } from "./price-board";

export const directoryRefreshInterval=5*60*60_000;
const leaseDuration=90_000;
const historyDays=7;
type Run={id:number;started_at:string;finished_at:string|null;lease_until:string;token:string|null;targets:number;search_state:string;
  search_query:string;search_urls:string;search_reserved_milli:number;search_billable_milli:number;search_error:string;
  rate_state:string;rate_day:string|null;rate_error:string;last_error:string;reachable:number;restricted:number;unconfirmed:number;quotes_checked:number;quotes_changed:number;
  automatic_discovery:0|1};
export type RefreshTarget={id:number;kind:"site"|"domain"|"price";site_id:number|null;domain:string|null;url:string};
export type RefreshLease={run:Run;token:string};
const iso=(value:number)=>new Date(value).toISOString();

function addTargets(db:DatabaseSync,run:number,stamp:string) {
  const pricing=new Map(refreshablePublicQuotes(db).map(row=>[JSON.stringify([row.site_id,row.source_url]),row]));
  const add=db.prepare("INSERT INTO directory_refresh_targets(run_id,kind,site_id,url) VALUES (?,'price',?,?)");
  for (const row of pricing.values()) add.run(run,row.site_id,row.source_url);
  db.prepare(`INSERT INTO directory_refresh_targets(run_id,kind,site_id,url)
    SELECT ?,'site',s.id,s.website FROM sites s WHERE s.publication='published' AND s.lifecycle<>'closed'
      AND NOT EXISTS (SELECT 1 FROM merchant_storefronts sf WHERE sf.site_id=s.id AND sf.url=s.website
        AND (sf.host IN ('16688.com.cn','catfk.com') OR sf.source_url GLOB 'https://ai.pricememo.cn/data/v1/snapshots/*.json'))
    ORDER BY s.id`).run(run);
  db.prepare(`INSERT INTO directory_refresh_sources(run_id,source_id)
    SELECT ?,s.id FROM discovery_sources s
    LEFT JOIN (
      SELECT source_id,max(r.started_at) last_run FROM directory_refresh_sources jobs
      JOIN directory_refresh_runs r ON r.id=jobs.run_id GROUP BY source_id
    ) previous ON previous.source_id=s.id
    WHERE s.enabled=1 AND s.pipeline<>'connections' AND s.access IN ('licensed','official') AND s.kind IN ('page','sitemap','dataset')
      AND (previous.last_run IS NULL OR julianday(?)>=julianday(previous.last_run)+s.interval_hours/24.0)
    ORDER BY previous.last_run,s.id LIMIT 4`).run(run,stamp);
  db.prepare("UPDATE directory_refresh_runs SET targets=(SELECT count(*) FROM directory_refresh_targets WHERE run_id=?) WHERE id=?").run(run,run);
}

export function claimRefresh(db:DatabaseSync,clock:number):RefreshLease|null {
  return transaction(db,()=>{
    const time=iso(clock);
    const previous=one<Run>(db,"SELECT * FROM directory_refresh_runs ORDER BY id DESC LIMIT 1");
    let id=previous?.id;
    if (!previous||previous.finished_at) {
      if (previous?.automatic_discovery&&clock<Date.parse(previous.started_at)+directoryRefreshInterval) return null;
      id=Number(db.prepare("INSERT INTO directory_refresh_runs(started_at,automatic_discovery) VALUES (?,1)").run(time).lastInsertRowid);
      addTargets(db,id,time);
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
    const complete=progress.done===run.targets&&progress.ratesDone&&progress.searchDone&&progress.sources.pending===0&&progress.leads.pending===0;
    db.prepare(`UPDATE directory_refresh_runs SET token=NULL,lease_until='',finished_at=?,reachable=?,restricted=?,unconfirmed=?,
      quotes_checked=?,quotes_changed=?,last_error=? WHERE id=? AND token=?`)
      .run(complete?iso(clock):null,progress.reachable,progress.restricted,progress.unconfirmed,
        progress.quotes_checked+progress.leads.quotesChecked,progress.quotes_changed+progress.leads.quotesChanged,error,run.id,token);
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
  const leads=one<{total:number;pending:number;published:number;updated:number;known:number;held:number;quotesChecked:number;quotesChanged:number}>(db,`SELECT count(*) total,
    count(CASE WHEN checked_at IS NULL THEN 1 END) pending,
    count(CASE WHEN result='published' THEN 1 END) published,count(CASE WHEN result='updated' THEN 1 END) updated,
    count(CASE WHEN result='known' THEN 1 END) known,count(CASE WHEN result IN ('restricted','unreachable','needs_evidence','review','error') THEN 1 END) held,
    coalesce(sum(quotes_checked),0) quotesChecked,coalesce(sum(quotes_changed),0) quotesChanged
    FROM directory_refresh_leads WHERE run_id=?`,run)!;
  const sources=one<{pending:number;collected:number;failed:number}>(db,`SELECT count(CASE WHEN state='pending' THEN 1 END) pending,
    count(CASE WHEN state='collected' THEN 1 END) collected,count(CASE WHEN state IN ('failed','skipped') THEN 1 END) failed
    FROM directory_refresh_sources WHERE run_id=?`,run)!;
  return {...data,leads,sources,searchDone:!["pending","reserved"].includes(search.search_state),ratesDone:search.rate_state!=="pending"};
}

export function directoryRefreshStatus(db=directory()) {
  const latest=one<Run>(db,"SELECT * FROM directory_refresh_runs ORDER BY id DESC LIMIT 1");
  const completed=one<Run>(db,"SELECT * FROM directory_refresh_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1");
  if (!latest) return {latest:null,completed:null,nextDue:null};
  const withProgress=(run:Run)=>{
    const progress=refreshProgress(db,run.id);
    const completed=!!run.finished_at;
    return {id:run.id,startedAt:run.started_at,finishedAt:run.finished_at,targets:run.targets,
      done:completed?run.targets:progress.done,automaticDiscovery:!!run.automatic_discovery,
      reachable:completed?run.reachable:progress.reachable,restricted:completed?run.restricted:progress.restricted,
      unconfirmed:completed?run.unconfirmed:progress.unconfirmed,
      quotesChecked:completed?run.quotes_checked:progress.quotes_checked+progress.leads.quotesChecked,
      quotesChanged:completed?run.quotes_changed:progress.quotes_changed+progress.leads.quotesChanged,
      leads:progress.leads,sources:progress.sources,
      search:run.search_state,searchQuery:run.search_query,reservedMilli:run.search_reserved_milli,billableMilli:run.search_billable_milli,searchError:run.search_error,
      rateDay:run.rate_day,rateError:run.rate_error,error:run.last_error};
  };
  return {latest:withProgress(latest),completed:completed?withProgress(completed):null,nextDue:iso(Date.parse(latest.started_at)+directoryRefreshInterval)};
}
