import type { DatabaseSync } from "node:sqlite";
import { all,one,transaction } from "./db";
import { approveItems,createImport,publishBatch } from "./imports";
import { merchantNameKey } from "./merchant-evidence";
import { pipelineForCategory } from "./taxonomy";
import { choice,dateValue,now,recordId,textValue,today,websiteUrl } from "./validation";
import { audit } from "./write";

type Outcome="verified"|"basic"|"duplicate"|"conflict"|"excluded"|"lead";
export const retainedResolutions=["unavailable","restricted","insufficient","redirected"] as const;
type RetainedResolution=typeof retainedResolutions[number];
type Entry={id:number;domain:string;state:string;reason:string;checked_at:string|null;item_id:number|null;review:string|null};
type PriorDecision={candidate_id:number;outcome:Outcome;reason:string;item_id:number|null;existing_site:number|null;evidence:string|null;resolved_as:RetainedResolution|null};
type LeadReview={candidate_id:number;checked_at:string;outcome:string;reason:string;proof_url:string|null;reachable:number;evidence:string|null};
type Proof={kind:"official"|"identity"|"independent";name:string;website:string;category:string;source:string;note:string;
  sourceKind:"official"|"pending";date:string;license:string|null;credit:string;previousItem:number|null};
type Disposition={kind:"exclude"|"hold"|"lead";note:string;source?:string;resolution?:RetainedResolution};
type Plan={id:number;outcome:Outcome;reason:string;existing_site?:number;proof?:Proof;oldItems?:number[];alias?:{domain:string;source:string;target:string};
  decisionSource?:string;resolution?:RetainedResolution;carry?:PriorDecision};
type AdmissionScope=number|{run:number;mode:"selection"|"automatic"};

const labels:Record<string,string>={"ai-topup":"AI 会员代充","ai-card":"AI 会员卡密或账号商品","ai-relay":"模型 API 中转或聚合",
  airport:"网络节点订阅",vpn:"商用 VPN","proxy-services":"代理 IP",vps:"云主机或服务器",residential:"住宅 IP 主机",
  "virtual-card":"虚拟卡","payment-accounts":"跨境支付","u-card":"稳定币支付卡","subscription-payment":"订阅支付"};

function publicUrl(value:unknown) {
  const normalized=new URL(websiteUrl(textValue(value,1500,"公开证据网址")).url);
  if (normalized.search||/\/(?:login|signin|checkout|invite|redirect|redeem|token|subscribe)(?:\/|$)/i.test(normalized.pathname)) throw new Error("请使用无追踪参数的公开资料页。");
  return normalized;
}

function inputs(db:DatabaseSync,campaign:number,raw:unknown,entries:Map<number,Entry>,reviews:Map<number,LeadReview>,selectedOnly:boolean) {
  if (!Array.isArray(raw)||raw.length>5000) throw new Error("录入证据须为最多 5,000 条 JSON 对象的数组。");
  const manifest=new Map<number,Proof|Disposition|{kind:"alias";note:string;target:string;source:string}>();
  for (const value of raw) {
    if (!value||typeof value!=="object"||Array.isArray(value)) throw new Error("缺少候选证据对象。");
    const id=recordId(value.id);
    const row=entries.get(id);
    if (!row||manifest.has(id)) throw new Error(`候选 #${id} 不存在或证据重复。`);
    const kind=choice(value.kind,["official","identity","independent","exclude","hold","lead","alias"] as const,"收录依据");
    const note=textValue(value.note,450,"编辑核验说明");
    if (note.length<12) throw new Error(`候选 #${id} 的说明须记录可复核事实。`);
    if (kind==="exclude"||kind==="hold"||kind==="lead") {
      const resolution=kind==="lead"&&value.resolution?choice(value.resolution,retainedResolutions,"归档原因"):undefined;
      manifest.set(id,{kind,note,source:value.source?publicUrl(value.source).href:undefined,resolution});
      continue;
    }
    const source=publicUrl(value.source).href;
    const evidenceDomain=websiteUrl(source).registrable;
    if (kind==="alias") {
      const target=websiteUrl(String(value.target)).registrable;
      const reason=reviews.get(id)?.reason??row.reason;
      const destination=reason.match(/(?:跳往(?:其他注册域[（(])?|规范网址指向)\s*([a-z\d.-]+)/i)?.[1];
      if (target===row.domain||evidenceDomain!==row.domain||destination!==target) throw new Error(`候选 #${id} 缺少可复核的同主体域名关系。`);
      manifest.set(id,{kind,note,target,source});continue;
    }
    const url=publicUrl(value.website);
    const root=websiteUrl(url.href);
    const name=textValue(value.name,100,"商家名称");
    const category=textValue(value.category,90,"商家分类");
    if (root.registrable!==row.domain||!pipelineForCategory(category)||!labels[category]||merchantNameKey(name).length<2||
        (kind!=="independent"&&name===root.domain&&!(selectedOnly&&kind==="identity"))) throw new Error(`候选 #${id} 的名称、注册域或分类无效。`);
    if (row.review==="published"||row.state==="known") continue;
    if (row.state==="rejected") throw new Error(`候选 #${id} 已拒绝，须先复核拒绝记录。`);
    let license:string|null=null;
    let credit="";
    if (kind==="independent") {
      const licensed=one<{license:string;credit:string}>(db,`SELECT json_extract(r.source_snapshot,'$.evidence_url') license,json_extract(r.source_snapshot,'$.name') credit
        FROM merchant_source_links l JOIN merchant_source_runs r ON r.id=l.run_id WHERE l.candidate_id=? AND l.evidence_url=?
        AND r.campaign_id=? AND r.state IN ('ok','partial') AND json_extract(r.source_snapshot,'$.access')='licensed'
        AND l.name_hint=? AND l.filter_reason=''`,id,source,campaign,name);
      if (!licensed||evidenceDomain===row.domain) throw new Error(`候选 #${id} 缺少有复用许可且明确记载商家名称的独立来源。`);
      license=licensed.license;
      credit=licensed.credit;
    } else {
      if (evidenceDomain!==row.domain) throw new Error(`候选 #${id} 的官网证据必须属于同一注册域。`);
      if (selectedOnly&&kind==="identity"&&!one(db,`SELECT 1 FROM merchant_verification_attempts
        WHERE candidate_id=? AND outcome='identity' AND proof_url=?`,id,source)) throw new Error(`候选 #${id} 缺少该公开页面的经营证据核对记录。`);
      if (kind==="official"&&(!(reviews.get(id)?.checked_at??row.checked_at)||!one(db,`SELECT 1 FROM merchant_verification_attempts
        WHERE candidate_id=? AND outcome IN ('ready','manual') AND proof_url=?`,id,source))) throw new Error(`候选 #${id} 缺少已完成官网核查记录。`);
    }
    if (!(selectedOnly&&kind==="identity")&&row.state==="manual"&&/指向|其他注册域|品牌名称、别名/.test(row.reason)) throw new Error(`候选 #${id} 有主体冲突，须在后台先解决。`);
    manifest.set(id,{kind,name,website:kind==="official"?url.href:url.origin+"/",category,source,note,
      date:value.date?dateValue(value.date,"来源访问日期"):today(),sourceKind:kind==="independent"?"pending":"official",license,credit,
      previousItem:value.previousItem==null?null:recordId(value.previousItem)});
  }
  return manifest;
}

const leadReasons:Record<string,{outcome:Outcome;reason:string}>={
  rejected:{outcome:"excluded",reason:"已有编辑排除记录"},
  filtered:{outcome:"lead",reason:"旧规则未识别出官网经营证据，保留发现线索"},
  manual:{outcome:"conflict",reason:"经营主体或链接归属待确认"},
  ready:{outcome:"conflict",reason:"有官网页面证据，仍需确认品牌、主营或经营主体"},
  unverified:{outcome:"lead",reason:"官网核查未完成，缺少可公开的独立证据"},
};

export function merchantAdmission(db:DatabaseSync,campaign:number,raw:unknown,actor:string,apply=false,scope?:AdmissionScope) {
  const selectedOnly=typeof scope==="object";
  const automatic=selectedOnly&&scope.mode==="automatic";
  const leadRun=typeof scope==="number"?scope:scope?.run;
  const applied=automatic?one<{id:number}>(db,"SELECT id FROM merchant_admission_runs WHERE reviewed_run_id=? AND campaign_id=?",scope.run,campaign):undefined;
  if (applied) return {run:applied.id,...admissionStatistics(db,campaign,applied.id),alreadyApplied:true};
  if (!one(db,"SELECT id FROM merchant_campaigns WHERE id=? AND state='paused'",campaign)) throw new Error("请先暂停采集任务，再复核候选池。");
  const entries=new Map(all<Entry>(db,`SELECT c.id,c.registrable domain,c.state,c.reason,c.checked_at,c.item_id,i.state review
    FROM merchant_candidates c LEFT JOIN import_items i ON i.id=c.item_id WHERE c.campaign_id=? ORDER BY c.id`,campaign).map(r=>[r.id,r]));
  if ([...entries.values()].some(row=>row.state==="checking")) throw new Error("仍有官网核查在运行。");
  const prior=new Map<number,PriorDecision>();
  const reviews=new Map<number,LeadReview>();
  if (leadRun!==undefined) {
    if (one<{id:number}>(db,"SELECT max(id) id FROM merchant_admission_runs WHERE campaign_id=?",campaign)?.id!==leadRun) {
      throw new Error("指定的线索复核必须对应当前收录批次。");
    }
    for (const row of all<PriorDecision>(db,"SELECT * FROM merchant_admission_decisions WHERE run_id=?",leadRun)) prior.set(row.candidate_id,row);
    for (const row of all<LeadReview>(db,`SELECT r.*,EXISTS(SELECT 1 FROM json_each(r.pages) p
      WHERE json_extract(p.value,'$.status') BETWEEN 200 AND 299) reachable FROM merchant_lead_reviews r
      JOIN merchant_admission_decisions a ON a.run_id=r.admission_run_id AND a.candidate_id=r.candidate_id
      WHERE r.admission_run_id=? AND r.checked_at IS NOT NULL AND (? OR a.outcome='lead')`,leadRun,selectedOnly?1:0)) reviews.set(row.candidate_id,row);
    if (!selectedOnly&&reviews.size!==[...prior.values()].filter(row=>row.outcome==="lead").length) throw new Error("请先完成该批次全部线索的逐条复核。");
  }
  const allowed=leadRun===undefined?entries:new Map([...entries].filter(([id])=>{
    if(!selectedOnly) return reviews.has(id);
    const decision=prior.get(id);
    if (automatic) return !!decision&&!decision.resolved_as&&(decision.outcome==="lead"||decision.outcome==="conflict");
    return !decision||decision.outcome==="lead"||decision.outcome==="conflict";
  }));
  const manifest=inputs(db,campaign,raw,allowed,reviews,selectedOnly);
  if (automatic&&[...allowed.keys()].some(id=>!reviews.has(id)||!manifest.has(id))) {
    throw new Error("自动收录需要当前候选池逐条完成核查并记录决定。");
  }
  const groups=all<{registrable:string;site_id:number;name:string;aliases:string}>(db,`SELECT DISTINCT d.registrable,d.site_id,s.name,s.aliases
    FROM site_domains d JOIN sites s ON s.id=d.site_id WHERE s.publication='published'`);
  const domains=new Map(groups.map(row=>[row.registrable,row.site_id]));
  const knownNames=new Set(groups.flatMap(row=>[row.name,...JSON.parse(row.aliases) as string[]]).map(merchantNameKey));
  const likely=new Map<string,number>();
  for (const proof of manifest.values()) if ("name" in proof) likely.set(merchantNameKey(proof.name),(likely.get(merchantNameKey(proof.name))??0)+1);
  const members=automatic?[...entries.values()].filter(row=>prior.has(row.id)):[...entries.values()];
  const plans:Plan[]=members.map(row=>{
    const previous=prior.get(row.id);
    if (previous&&(selectedOnly?!manifest.has(row.id):previous.outcome!=="lead")) {
      return {id:row.id,outcome:previous.outcome,reason:previous.reason,carry:previous,resolution:previous.resolved_as??undefined};
    }
    const existing=domains.get(row.domain);
    if (existing) return {id:row.id,outcome:"duplicate",reason:"注册域已对应公开档案",existing_site:existing};
    const checked=reviews.get(row.id);
    const destination=automatic&&checked?.outcome==="redirect"?checked.reason.match(/^公开页面跳往 ([a-z0-9.-]+)，/i)?.[1]:undefined;
    const recordedShop=automatic&&/已收录.+(?:商城|店铺|档案)/.test(previous?.reason??"")?
      row.reason.match(/^购买入口指向 ([a-z0-9.-]+)$/i)?.[1]:undefined;
    const forwarded=destination??recordedShop;
    const redirectedSite=forwarded&&domains.get(forwarded);
    if (redirectedSite) {
      return {id:row.id,outcome:"duplicate",reason:"公开入口或购买地址指向已收录站点，保留来源记录。",existing_site:redirectedSite,decisionSource:checked?.proof_url??undefined};
    }
    const proof=manifest.get(row.id);
    if (proof?.kind==="exclude"||proof?.kind==="hold"||proof?.kind==="lead") {
      const outcome={exclude:"excluded",hold:"conflict",lead:"lead"} as const;
      return {id:row.id,outcome:outcome[proof.kind],reason:proof.note,decisionSource:proof.source,resolution:proof.resolution};
    }
    if (proof?.kind==="alias") {
      const target=domains.get(proof.target);
      return target?{id:row.id,outcome:"duplicate",reason:proof.note,existing_site:target,alias:{domain:websiteUrl(proof.source).domain,source:proof.source,target:proof.target}}
        :{id:row.id,outcome:"conflict",reason:"别名的主档案尚未公开"};
    }
    if (!proof||!("name" in proof)) {
      const result=reviews.get(row.id);
      if (result) {
        const outcome=result.outcome==="non_merchant"?"excluded":["merchant","possible","redirect","existing"].includes(result.outcome)?"conflict":"lead";
        return {id:row.id,outcome,reason:result.reason};
      }
      return {id:row.id,...(leadReasons[row.state]??{outcome:"lead",reason:"仅有发现线索"})};
    }
    const brand=merchantNameKey(proof.name);
    if (knownNames.has(brand)||(likely.get(brand)??0)>1) {
      return {id:row.id,outcome:"conflict",reason:"与另一注册域的档案使用同一名称或别名，需确认是否重复。",decisionSource:proof.source};
    }
    const pending=all<{id:number;state:string}>(db,"SELECT id,state FROM import_items WHERE registrable=? AND state IN ('ready','approved')",row.domain);
    const priorItem=pending[0];
    const blocked=automatic?pending.some(item=>item.state!=="ready"):
      pending.length>1||priorItem&&(priorItem.state!=="ready"||priorItem.id!==(proof.previousItem??row.item_id));
    if (blocked) return {id:row.id,outcome:"conflict",reason:"同域存在已有审批的独立批次，需确认唯一发布档案。",decisionSource:proof.source};
    return {id:row.id,outcome:proof.kind==="official"?"verified":"basic",reason:proof.note,proof,oldItems:pending.map(item=>item.id)};
  });
  const selectedPlans=plans.filter(row=>manifest.has(row.id));
  const assessed=selectedOnly?selectedPlans:leadRun===undefined?plans:plans.filter(row=>reviews.has(row.id));
  if (!apply) return {processed:assessed.length,counts:countOutcomes(assessed),plans:selectedPlans};
  const staged=transaction(db,()=>{
    if (!one(db,"SELECT id FROM merchant_campaigns WHERE id=? AND state='paused'",campaign)) throw new Error("采集任务已恢复，请重新预览。");
    if (leadRun!==undefined && one<{id:number}>(db,"SELECT max(id) id FROM merchant_admission_runs WHERE campaign_id=?",campaign)?.id!==leadRun) throw new Error("收录批次已改变，请重新预览。");
    const run=Number(db.prepare("INSERT INTO merchant_admission_runs(campaign_id,created_at,actor,reviewed_run_id) VALUES (?,?,?,?)")
      .run(campaign,now(),actor,automatic?scope.run:null).lastInsertRowid);
    const register=db.prepare(`INSERT INTO merchant_admission_decisions(run_id,candidate_id,outcome,reason,item_id,existing_site,evidence,resolved_as)
      VALUES (?,?,?,?,?,?,?,?)`);
    const selected=plans.filter(plan=>plan.proof);
    for (const plan of selected) for (const oldItem of plan.oldItems??[]) {
      const old=one(db,"SELECT state,message,payload FROM import_items WHERE id=? AND state='ready'",oldItem);
      if (!old) throw new Error("旧审核项已改变，请重新预览。");
      const message=`已交由收录复核 #${run}，保留原始审核记录。`;
      db.prepare("UPDATE import_items SET state='duplicate',message=? WHERE id=?").run(message,oldItem);
      audit(db,actor,"admission_reconcile","import_items",oldItem,old,{state:"duplicate",message});
    }
    const batch=selected.length?createImport(db,JSON.stringify(selected.map(({proof:p,outcome})=>{
      const proof=p!;
      return {url:proof.website,name:proof.name,category:proof.category,basis:outcome==="basic"?"basic":"official",source_url:proof.source,
        source_kind:proof.sourceKind,source_title:proof.kind==="independent"?"开放登记资料 · 身份线索":"商家公开服务资料",
        snapshot_at:proof.date,excerpt:proof.note,summary:`官网公开资料列有${labels[proof.category]}。`,license_url:proof.license};
    })),"json",actor,true):null;
    const items=batch?all<{id:number;registrable:string;state:string}>(db,"SELECT id,registrable,state FROM import_items WHERE batch_id=?",batch):[];
    const byDomain=new Map(items.map(item=>[item.registrable,item]));
    const ids:number[]=[];
    for (const plan of plans) {
      if (plan.carry) {
        register.run(run,plan.id,plan.outcome,plan.reason,plan.carry.item_id,plan.carry.existing_site,plan.carry.evidence,plan.carry.resolved_as);
        continue;
      }
      const row=entries.get(plan.id)!;
      const item=byDomain.get(row.domain);
      const review=reviews.get(row.id);
      if (plan.proof) {
        if (item?.state!=="ready") throw new Error(`候选 #${row.id} 导入未通过，请重新预览。`);
        ids.push(item.id);
        for (const oldItem of plan.oldItems??[]) db.prepare(`INSERT OR IGNORE INTO candidate_sources(item_id,source_url,source_name,license_url,acquired_at)
          SELECT ?,source_url,source_name,license_url,acquired_at FROM candidate_sources WHERE item_id=?`).run(item.id,oldItem);
        const identityCheck=selectedOnly?one<{checked_at:string;reason:string}>(db,`SELECT checked_at,reason FROM merchant_verification_attempts
          WHERE candidate_id=? AND proof_url=? AND outcome='identity' ORDER BY id DESC LIMIT 1`,row.id,plan.proof.source):undefined;
        const reach=plan.outcome==="verified"||identityCheck||review?.reachable?"reachable":review?review.outcome==="restricted"?"restricted":review.outcome==="unavailable"?"unreachable":"inconclusive":row.state==="unverified"?
          /禁止|403|451|访问验证/.test(row.reason)?"restricted":/timeout|超时|\[dns\]/i.test(row.reason)?"unreachable":"inconclusive":row.checked_at?"inconclusive":"unchecked";
        db.prepare("UPDATE import_items SET reachability=?,checked_at=?,check_detail=?,final_url=? WHERE id=?")
          .run(reach,identityCheck?.checked_at??review?.checked_at??row.checked_at,identityCheck?.reason??review?.reason??row.reason,
            plan.outcome==="verified"||identityCheck?plan.proof.source:review?.reachable?review.proof_url:null,item.id);
        db.prepare("UPDATE merchant_candidates SET item_id=? WHERE id=?").run(item.id,row.id);
      }
      if (plan.alias&&plan.existing_site) {
        db.prepare("INSERT INTO site_domains(domain,site_id,kind,registrable) VALUES (?,?,'alias',?)").run(plan.alias.domain,plan.existing_site,row.domain);
        audit(db,actor,"confirmed_domain_alias","sites",plan.existing_site,null,{...plan.alias,reason:plan.reason});
      }
      const evidence=plan.proof??plan.alias;
      register.run(run,row.id,plan.outcome,plan.reason,plan.proof?item!.id:null,plan.existing_site??null,
        evidence?JSON.stringify(evidence):review||plan.decisionSource?JSON.stringify({reviewRun:leadRun,assessment:review?.outcome,source:plan.decisionSource??review?.proof_url}):null,
        plan.resolution??null);
    }
    if (batch) {
      const approved=approveItems(db,batch,ids,actor,true);
      if (approved.count!==ids.length) throw new Error(`收录复核 #${run} 未全部通过：${approved.flags.join("；")}`);
      if (publishBatch(db,batch,actor,ids,true)!==ids.length) throw new Error(`收录复核 #${run} 未完整写入，批次已回滚。`);
    }
    return run;
  });
  return {run:staged,...admissionStatistics(db,campaign),...(leadRun===undefined?{}:{rechecked:assessed.length})};
}

function countOutcomes(rows:Plan[]) {
  return Object.fromEntries((["verified","basic","duplicate","conflict","excluded","lead",...retainedResolutions] as const)
    .map(outcome=>[outcome,rows.filter(row=>(row.resolution??row.outcome)===outcome).length]));
}

export function admissionStatistics(db:DatabaseSync,campaign?:number,runId?:number) {
  const latest=one<{id:number;campaign_id:number}>(db,`SELECT id,campaign_id FROM merchant_admission_runs
    WHERE (? IS NULL OR campaign_id=?) AND (? IS NULL OR id=?) ORDER BY id DESC LIMIT 1`,campaign??null,campaign??null,runId??null,runId??null);
  const publicCounts=one<{total:number;verified:number;pending:number}>(db,`SELECT count(*) total,
    count(CASE WHEN status<>'listed' THEN 1 END) verified,count(CASE WHEN status='listed' THEN 1 END) pending FROM sites WHERE publication='published'`)!;
  const outcomes=latest?all<{outcome:Outcome|RetainedResolution;n:number;published:number;added:number}>(db,`SELECT coalesce(a.resolved_as,a.outcome) outcome,count(*) n,
    count(CASE WHEN i.state='published' AND s.publication='published' THEN 1 END) published,
    count(CASE WHEN i.state='published' AND s.publication='published' AND NOT EXISTS(
      SELECT 1 FROM merchant_admission_decisions p WHERE p.item_id=a.item_id AND p.run_id<a.run_id) THEN 1 END) added
    FROM merchant_admission_decisions a LEFT JOIN import_items i ON i.id=a.item_id LEFT JOIN sites s ON s.id=i.site_id
    WHERE a.run_id=? GROUP BY coalesce(a.resolved_as,a.outcome)`,latest.id):[];
  return {publicCounts,runId:latest?.id??null,processed:outcomes.reduce((n,row)=>n+row.n,0),
    pendingCandidates:outcomes.reduce((n,row)=>n+(["conflict","lead","verified","basic"].includes(row.outcome)?row.n-row.published:0),0),
    archived:outcomes.filter(row=>retainedResolutions.some(outcome=>outcome===row.outcome)).reduce((n,row)=>n+row.n,0),
    added:outcomes.reduce((n,row)=>n+row.added,0),outcomes};
}
