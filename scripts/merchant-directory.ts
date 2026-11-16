import { existsSync,readFileSync,statSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { all,directory,one } from "../lib/directory/db";
import { approveItems,candidate,createImport,holdCandidate,importLimits,parseImport,publishBatch,reviseItem,type Format } from "../lib/directory/imports";
import type { ImportItem } from "../lib/directory/types";
import { choice,recordId } from "../lib/directory/validation";
import { checkWebsite,saveCheck } from "../lib/directory/website-check";
import { coverageRuns,coverageTotals,recordCoverage } from "../lib/directory/coverage";
import { deepSeekSearchUsage,discoveryJobs,discoverySources,queueDiscovery,queueDue,retryDiscovery,runDiscovery,saveDiscoverySource } from "../lib/directory/discovery";
import type { Lead } from "../lib/directory/discovery-providers";
import { addMerchantQueries,controlMerchantCampaign,createMerchantCampaign,merchantCampaignReport,recoverMerchantHomepageLeads,searchMerchantCampaign } from "../lib/directory/merchant-campaign";
import { storefrontSeeds } from "../lib/directory/merchant-queries";
import { focusedMerchantSeeds } from "../lib/directory/focused-merchant-queries";
import { admissionStatistics,merchantAdmission } from "../lib/directory/merchant-admission";
import { leadReviewReport,refineMerchantBacklog,reviewMerchantLeads } from "../lib/directory/merchant-lead-review";
import { resolveMerchantBacklog } from "../lib/directory/merchant-backlog";
import { reconcileMerchantCandidate,rejectMerchantCandidates,requeueMerchantTimeouts,stageMerchantCampaign,verifyMerchantCampaign } from "../lib/directory/merchant-verification";
import { intakeMerchantSource,merchantSourceReport,sourceAdapters } from "../lib/directory/merchant-source-intake";
import { exportMerchantCandidates } from "../lib/directory/merchant-candidate-export";
import { pipelines,type Pipeline } from "../lib/directory/taxonomy";

for (const file of [".env.local",".env"]) if (existsSync(file)) loadEnvFile(file);
const [command,...args]=process.argv.slice(2);
const actor="directory-cli";
const db=directory();
const print=(data:unknown)=>console.log(JSON.stringify(data,null,2));
function fieldFile(file:string) {
  if (!file || statSync(file).size>importLimits.bytes) throw new Error("请选择不大于 8 MB 的导入文件。");
  return readFileSync(file,"utf8");
}
function batchArg(value:string) {
  const id=recordId(value);
  if (!one(db,"SELECT 1 FROM import_batches WHERE id=?",id)) throw new Error("批次不存在。");
  return id;
}
function report() {
  const sourceStats=all(db,`SELECT source_name,count(DISTINCT domain) hosts,count(DISTINCT registrable) registrable_domains,
      count(DISTINCT CASE WHEN state IN ('ready','approved','published') THEN domain END) canonical_candidates
    FROM candidate_sources c JOIN import_items i ON i.id=c.item_id GROUP BY source_name ORDER BY hosts DESC,source_name`);
  return {
    receipts:one(db,`SELECT coalesce(sum(json_extract(after_json,'$.rows')),0) attempted,
      coalesce(sum(json_extract(after_json,'$.skipped')),0) repeated_same_source
      FROM audit_log WHERE entity='import_batches' AND action='preview'`),
    unique:one(db,`SELECT count(DISTINCT domain) hosts,count(DISTINCT registrable) registrable_domains,
      count(DISTINCT CASE WHEN state IN ('ready','approved','published') THEN domain END) candidates,
      count(DISTINCT CASE WHEN state IN ('ready','approved','published') THEN registrable END) candidate_registrable_domains,
      count(DISTINCT CASE WHEN reachability='reachable' THEN domain END) reachable_hosts,
      count(DISTINCT CASE WHEN reachability='reachable' THEN registrable END) reachable_registrable_domains,
      count(DISTINCT CASE WHEN state IN ('ready','approved','published') AND reachability='reachable' THEN domain END) reachable_candidates
      FROM import_items`),
    states:all(db,"SELECT state,count(*) total FROM import_items GROUP BY state"),
    categories:all(db,`SELECT coalesce(nullif(json_extract(payload,'$.category'),''),'未分类') category,state,count(*) total
      FROM import_items WHERE state IN ('ready','approved','published') GROUP BY category,state ORDER BY category,state`),
    check_states:all(db,`SELECT i.reachability,count(*) total FROM import_items i
      WHERE state IN ('ready','approved','published') GROUP BY i.reachability`),
    check_reasons:all(db,`SELECT reachability,check_detail,count(*) total FROM import_items
      WHERE checked_at IS NOT NULL AND reachability<>'reachable' GROUP BY reachability,check_detail ORDER BY total DESC`),
    import_failures:all(db,"SELECT message,count(*) total FROM import_items WHERE state='failed' GROUP BY message"),
    recovered_failures:one(db,`SELECT count(DISTINCT entity_id) total FROM audit_log WHERE entity='import_items'
      AND action='retry' AND json_extract(before_json,'$.state')='failed' AND json_extract(after_json,'$.state')<>'failed'`),
    website_history:all(db,"SELECT result,count(*) total FROM website_checks GROUP BY result"),
    sourceStats,
    published:all(db,`SELECT category_slug,lifecycle,status,count(*) total FROM sites WHERE publication='published'
      GROUP BY category_slug,lifecycle,status ORDER BY category_slug`),
    coverage:one(db,`SELECT count(*) total,count(CASE WHEN json_extract(payload,'$.summary')<>'' THEN 1 END) has_summary,
      count(CASE WHEN json_extract(payload,'$.source_url')<>'' THEN 1 END) has_source,
      count(CASE WHEN json_extract(payload,'$.merchant_details.ai_products')<>'' THEN 1 END) has_ai_products,
      count(CASE WHEN json_extract(payload,'$.merchant_details.delivery_methods')<>'' THEN 1 END) has_delivery,
      count(CASE WHEN json_extract(payload,'$.merchant_details.monthly_price')<>'' THEN 1 END) has_monthly_price,
      count(CASE WHEN json_extract(payload,'$.merchant_details.monthly_traffic')<>'' THEN 1 END) has_monthly_traffic,
      count(CASE WHEN checked_at IS NOT NULL THEN 1 END) checked
      FROM import_items WHERE state IN ('ready','approved','published')`),
  };
}
async function run() {
  switch(command) {
    case "campaign-create":
      print(createMerchantCampaign(db,args[0]??"商家数据库扩容",Math.round(Number(args[1]??10)*1000),actor));
      break;
    case "campaign-focus-create": {
      const used=one<{n:number}>(db,`SELECT (SELECT coalesce(sum(unit_milli),0) FROM merchant_requests)
        + (SELECT coalesce(sum(requests),0)*5 FROM deepseek_search_usage) n`)!.n;
      print(createMerchantCampaign(db,args[0]??"AI 零售、机场与 API 中转",10_000-used,actor,focusedMerchantSeeds()));
      break;
    }
    case "campaign-resume":
    case "campaign-pause":
      print(controlMerchantCampaign(db,recordId(args[0]),command==="campaign-resume"?"running":"paused",actor));
      break;
    case "campaign-search": {
      const id=recordId(args[0]);
      const pipeline=args[2]?choice(args[2],Object.keys(pipelines) as Pipeline[],"采集管线"):undefined;
      print({attempts:await searchMerchantCampaign(db,id,recordId(args[1]??25),pipeline),report:merchantCampaignReport(db,id)});
      break;
    }
    case "campaign-verify": {
      const id=recordId(args[0]);
      const pipeline=args[2]?choice(args[2],Object.keys(pipelines) as Pipeline[],"核查管线"):undefined;
      print({verified:await verifyMerchantCampaign(db,id,recordId(args[1]??200),pipeline),staged:stageMerchantCampaign(db,id,actor)});
      break;
    }
    case "campaign-stage":
      print(stageMerchantCampaign(db,recordId(args[0]),actor));
      break;
    case "campaign-reconcile-candidate":
      print({item:reconcileMerchantCandidate(db,recordId(args[0]),recordId(args[1]),actor)});
      break;
    case "campaign-reject-reviewed": {
      const ids:unknown=JSON.parse(fieldFile(args[1]));
      if (!Array.isArray(ids)||!ids.length||ids.length>500) throw new Error("筛除文件须为 1 至 500 个已复核的候选编号。");
      print({rejected:rejectMerchantCandidates(db,recordId(args[0]),ids.map(recordId),args[2],actor)});
      break;
    }
    case "campaign-run": {
      const id=recordId(args[0]);
      const pipeline=args[3]?choice(args[3],Object.keys(pipelines) as Pipeline[],"采集管线"):undefined;
      const requested=await searchMerchantCampaign(db,id,recordId(args[1]??25),pipeline);
      const checked=await verifyMerchantCampaign(db,id,recordId(args[2]??350),pipeline);
      print({requested,checked,staged:stageMerchantCampaign(db,id,actor),report:merchantCampaignReport(db,id)});
      break;
    }
    case "campaign-publish-reviewed": {
      const id=recordId(args[0]);
      const input=JSON.parse(fieldFile(args[1])) as unknown;
      if (!Array.isArray(input)||input.length<1||input.length>5000) throw new Error("审核文件须为候选编号或 {id,name} 的 JSON 数组。");
      const reviewed=new Map<number,string>();
      for (const entry of input) {
        if (entry && typeof entry==="object" && !Array.isArray(entry)) {
          if (typeof entry.name!=="string" || !entry.name.trim()) throw new Error("更正后的商家名称不能为空。");
          reviewed.set(recordId(entry.id),entry.name);
        } else reviewed.set(recordId(entry),"");
      }
      const groups=new Map<number,number[]>();
      const skipped:number[]=[];
      for (const [candidateId,name] of reviewed) {
        const row=one<{id:number;batch_id:number;payload:string}>(db,`SELECT i.id,i.batch_id,i.payload FROM merchant_candidates c JOIN import_items i ON i.id=c.item_id
          WHERE c.campaign_id=? AND c.id=? AND c.state='ready' AND i.state IN ('ready','approved') AND i.message=''`,id,candidateId);
        if (!row) { skipped.push(candidateId);continue; }
        if (name) reviseItem(db,row.id,JSON.stringify({...JSON.parse(row.payload),name}),actor,false);
        groups.set(row.batch_id,[...(groups.get(row.batch_id)??[]),row.id]);
      }
      print({skipped,batches:[...groups.entries()].map(([batch,ids])=>{
        const approved=approveItems(db,batch,ids,actor);
        return {batch,approved,published:publishBatch(db,batch,actor,ids)};
      })});
      break;
    }
    case "campaign-report":
      print(merchantCampaignReport(db,recordId(args[0])));
      break;
    case "campaign-admission":
      print(merchantAdmission(db,recordId(args[0]),JSON.parse(fieldFile(args[1])),actor,args[2]==="--apply"));
      break;
    case "campaign-admission-report":
      print(admissionStatistics(db,recordId(args[0])));
      break;
    case "campaign-review-leads":
      print(await reviewMerchantLeads(db,recordId(args[0]),recordId(args[1]??5000)));
      break;
    case "campaign-review-basic":
      print(await reviewMerchantLeads(db,recordId(args[0]),recordId(args[1]??5000),undefined,"basic"));
      break;
    case "campaign-review-backlog":
      print(await reviewMerchantLeads(db,recordId(args[0]),recordId(args[1]??5000),undefined,"backlog"));
      break;
    case "campaign-lead-review-report":
      print(leadReviewReport(db,recordId(args[0])));
      break;
    case "campaign-basic-review-report":
      print(leadReviewReport(db,recordId(args[0]),"basic"));
      break;
    case "campaign-backlog-review-report":
      print(leadReviewReport(db,recordId(args[0]),"backlog"));
      break;
    case "campaign-refine-backlog":
      print(await refineMerchantBacklog(db,recordId(args[0])));
      break;
    case "campaign-resolve-backlog": {
      const run=recordId(args[0]);
      const apply=args[1]==="--apply";
      if (apply&&!one(db,"SELECT id FROM merchant_admission_runs WHERE reviewed_run_id=?",run)) {
        await reviewMerchantLeads(db,run,5000,undefined,"backlog");
        const followup=await refineMerchantBacklog(db,run);
        if (!followup.ready) {print({ready:false,followup});break;}
      }
      print(resolveMerchantBacklog(db,run,actor,apply));
      break;
    }
    case "campaign-admit-reviewed-leads":
    case "campaign-admit-selection": {
      const run=recordId(args[0]);
      const row=one<{campaign_id:number}>(db,"SELECT campaign_id FROM merchant_admission_runs WHERE id=?",run);
      if (!row) throw new Error("收录批次不存在。");
      const scope=command==="campaign-admit-selection"?{run,mode:"selection" as const}:run;
      print(merchantAdmission(db,row.campaign_id,JSON.parse(fieldFile(args[1])),actor,args[2]==="--apply",scope));
      break;
    }
    case "campaign-source": {
      const adapter=choice(args[2]??"standard",sourceAdapters,"来源适配器");
      const manual=args[3]?JSON.parse(fieldFile(args[3])) as Lead[]:undefined;
      if (manual&&(!Array.isArray(manual)||manual.some(row=>!row||typeof row.url!=="string"))) throw new Error("手工来源必须提供 URL 对象数组。");
      print(await intakeMerchantSource(db,recordId(args[0]),recordId(args[1]),adapter,undefined,manual));
      break;
    }
    case "campaign-source-report":
      print(merchantSourceReport(db,recordId(args[0])));
      break;
    case "campaign-export-candidates":
      print(exportMerchantCandidates(db,recordId(args[0]),args[1]));
      break;
    case "campaign-recheck-timeouts":
      print({queued:requeueMerchantTimeouts(db,recordId(args[0]),recordId(args[1]??50))});
      break;
    case "campaign-storefronts": {
      const id=recordId(args[0]);
      addMerchantQueries(db,id,storefrontSeeds());
      print({recovered:recoverMerchantHomepageLeads(db,id)});
      break;
    }
    case "discovery-configure": {
      const sources=JSON.parse(fieldFile(args[0]));
      if (!Array.isArray(sources)||sources.length>100) throw new Error("来源清单必须是最多 100 个来源的数组。");
      print(sources.map(source=>saveDiscoverySource(db,source,actor)));
      break;
    }
    case "discovery-now": {
      const source=recordId(args[0]);
      const manual=args[1]?JSON.parse(fieldFile(args[1])) as Lead[]:undefined;
      if (manual && (!Array.isArray(manual)||!manual.length||manual.length>1000||manual.some(row=>!row||typeof row.url!=="string"))) throw new Error("本地名单必须是 1–1,000 条 JSON 网址对象。");
      const jobId=queueDiscovery(db,source,actor,!!manual);
      print(await runDiscovery(db,{jobId,manual,actor}));
      break;
    }
    case "discovery-tick": {
      queueDue(db);
      const results=[];
      const budget=Math.min(recordId(args[0]??1),10);
      for (let i=0;i<budget;i++) {
        const result=await runDiscovery(db,{actor});
        if (!result) break;
        results.push(result);
      }
      print(results);
      break;
    }
    case "discovery-retry":
      print({job:retryDiscovery(db,recordId(args[0]),actor)});
      break;
    case "discovery-report": {
      print({deepseek:deepSeekSearchUsage(db),sources:discoverySources(db),jobs:discoveryJobs(db,200),decisions:all(db,`SELECT json_extract(j.source_snapshot,'$.pipeline') pipeline,h.decision,count(*) total,
        count(DISTINCT h.registrable) unique_domains FROM discovery_hits h JOIN discovery_jobs j ON j.id=h.job_id
        GROUP BY pipeline,h.decision`),
        reasons:all(db,"SELECT reason,count(*) total FROM discovery_hits WHERE decision='held' GROUP BY reason ORDER BY total DESC")});
      break;
    }
    case "coverage-ingest": {
      const manifest=JSON.parse(fieldFile(args[0]));
      if (!Array.isArray(manifest) || !manifest.length || manifest.length>100) throw new Error("管线清单须是 1–100 个来源对象的 JSON 数组。");
      const result=manifest.map(source=>{
        const raw=source.file?fieldFile(source.file):source.rows?JSON.stringify(source.rows):"";
        return {...recordCoverage(db,source,raw,choice(source.format??"json",["csv","json","urls"],"导入格式"),actor),source:source.source_name};
      });
      print(result);
      break;
    }
    case "coverage-report": {
      const runs=coverageRuns(db);
      const published=all(db,`SELECT s.category_slug,s.status,s.basis,s.reachability,count(*) count
        FROM coverage_runs r JOIN import_items i ON i.batch_id=r.batch_id AND i.state='published'
        JOIN sites s ON s.id=i.site_id WHERE s.publication='published'
        GROUP BY s.category_slug,s.status,s.basis,s.reachability ORDER BY s.category_slug,s.status,s.reachability`);
      print({pipelines:coverageTotals(runs),sources:runs,published});
      break;
    }
    case "coverage-approve": {
      const batch=batchArg(args[0]);
      if (!one(db,"SELECT 1 FROM coverage_runs WHERE batch_id=? AND access IN ('licensed','official')",batch)) {
        throw new Error("请选择已完成来源审计的批次。");
      }
      const ids=all<{id:number}>(db,"SELECT id FROM import_items WHERE batch_id=? AND state='ready' ORDER BY id",batch).map(row=>row.id);
      print(approveItems(db,batch,ids,actor));
      break;
    }
    case "import": {
      const format:Format=choice(args[0],["csv","json","urls"],"导入格式");
      const batch=createImport(db,fieldFile(args[1]),format,actor);
      print({batch});
      break;
    }
    case "check-stale":
    case "check": {
      const stale=command==="check-stale";
      const selector=stale?"all":args[0]??"all";
      const batch=selector==="all"?null:batchArg(selector);
      const limit=Math.min(recordId((stale?args[0]:args[1])??(stale?100:5000)),5000);
      const retries=!stale&&args[2]==="retry";
      const cutoff=stale?new Date(Date.now()-Math.min(recordId(args[1]??30),365)*86400_000).toISOString():null;
      if (args[2]&&!retries) throw new Error("可选修饰符为 retry。");
      const rows=all<ImportItem>(db,`SELECT * FROM import_items WHERE (? IS NULL OR batch_id=?)
        AND state IN ('ready','approved','published') AND (checked_at IS NULL OR (?=1 AND reachability<>'reachable') OR checked_at<?)
        ORDER BY CASE WHEN ? IS NULL THEN NULL ELSE checked_at END,id LIMIT ?`,batch,batch,retries?1:0,cutoff,cutoff,limit);
      // One worker per registrable domain at a time.
      const grouped=new Map<string,ImportItem[]>();
      for (const row of rows) {
        const key=row.registrable??row.domain??String(row.id);
        const group=grouped.get(key)??[];
        group.push(row);grouped.set(key,group);
      }
      const queue=[...grouped.values()];
      const totals:Partial<Record<ImportItem["reachability"],number>>={};
      let done=0;
      await Promise.all(Array.from({length:Math.min(8,queue.length)},async()=>{
        for (let group=queue.shift();group;group=queue.shift()) {
          for (const row of group) {
            const data=candidate(JSON.parse(row.payload)).data;
            const result=await checkWebsite(data.url);
            if (!saveCheck(db,row,result)) continue;
            totals[result.state]=(totals[result.state]??0)+1;
            if (++done%50===0) console.error(`官网检查：${done}/${rows.length}`);
          }
        }
      }));
      print({checked:done,totals});
      break;
    }
    case "review": {
      const id=recordId(args[0]);
      print({batch:reviseItem(db,id,fieldFile(args[1]),actor,false)});
      break;
    }
    case "hold-candidate":
      holdCandidate(db,recordId(args[0]),args[1]??"",actor);
      break;
    case "retry-file": {
      const batch=batchArg(args[0]);
      const current=all<ImportItem>(db,"SELECT * FROM import_items WHERE batch_id=? AND state='failed' ORDER BY id",batch);
      const corrected=parseImport(fieldFile(args[1]),"json").map(row=>candidate(row).data);
      const byUrl=new Map(corrected.map(row=>[row.url,row]));
      let retried=0;
      for (const row of current) {
        const raw=JSON.parse(row.payload) as {url?:string}|null;
        const fix=raw?.url ? byUrl.get(raw.url) : undefined;
        if (!fix) continue;
        reviseItem(db,row.id,JSON.stringify(fix),actor,false);
        retried++;
      }
      print({batch,retried,stillFailed:current.length-retried});
      break;
    }
    case "apply-reviewed": {
      const input=JSON.parse(fieldFile(args[0])) as unknown;
      if (!Array.isArray(input) || !input.length || input.length>importLimits.rows) throw new Error("已复核文件须为 JSON 数组，且数量在 1–5,000 条。");
      const groups=new Map<number,number[]>();
      const missing:string[]=[];
      for (const row of input) {
        const checked=candidate(row);
        if (!checked.data.summary || checked.data.source_kind!=="official") throw new Error("已复核档案须包含编辑简介与商家官网来源。");
        const match=one<ImportItem>(db,`SELECT * FROM import_items WHERE domain=? AND state IN ('ready','approved')
          ORDER BY id LIMIT 1`,checked.domain);
        if (!match) { missing.push(checked.domain);continue; }
        const reviewed=checked.data;
        const existing=candidate(JSON.parse(match.payload)).data;
        const keepCheckedUrl=match.reachability==="reachable" && new URL(existing.url).pathname===new URL(reviewed.url).pathname;
        const batch=reviseItem(db,match.id,JSON.stringify({...reviewed,url:keepCheckedUrl?existing.url:reviewed.url}),actor,true);
        groups.set(batch,[...(groups.get(batch)??[]),match.id]);
      }
      print({approved:[...groups.entries()].map(([batch,ids])=>({batch,ids})),no_pending_match:missing});
      break;
    }
    case "approve": {
      const batch=batchArg(args[0]);
      const ids=(args[1]??"").split(",").map(recordId);
      print(approveItems(db,batch,ids,actor));
      break;
    }
    case "publish":
      print({published:publishBatch(db,batchArg(args[0]),actor)});
      break;
    case "report":
      print(report());
      break;
    default:
      throw new Error("子命令：campaign-create, campaign-resume, campaign-pause, campaign-search, campaign-report, discovery-configure, discovery-now, discovery-tick, discovery-retry, discovery-report, coverage-ingest, coverage-report, coverage-approve, import, check, check-stale, review, hold-candidate, retry-file, apply-reviewed, approve, publish, report。参数见 README。");
  }
}
run().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;}).finally(()=>db.close());
