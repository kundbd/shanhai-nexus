import type { DatabaseSync } from "node:sqlite";
import { all,one } from "./db";
import { admissionStatistics,merchantAdmission } from "./merchant-admission";
import { catalogSourceDisposition,type PageAssessment } from "./merchant-lead-page";
import { leadReviewReport } from "./merchant-lead-review";
import { pipelineForCategory } from "./taxonomy";
import { websiteUrl } from "./validation";

type Observation={candidate_id:number;registrable:string;state:string;review_state:string|null;checked_at:string;outcome:string;reason:string;
  proof_url:string|null;pages:string;evidence:string|null};
type SourcePage={status?:number;outcome:string;url:string;finalUrl?:string;assessment?:PageAssessment};
type Proof={id:number;kind:"identity";name:string;website:string;category:string;source:string;note:string;date:string;checkout?:string};
type Decision={id:number;kind:"hold"|"exclude"|"lead";note:string;source?:string;
  resolution?:"unavailable"|"restricted"|"insufficient"|"redirected"};

function publicEvidence(value:string|null) {
  if (!value) return undefined;
  try {
    const page=new URL(websiteUrl(value).url);
    if (!page.search&&!/\/(?:login|signin|checkout|invite|redirect|redeem|token|subscribe)(?:\/|$)/i.test(page.pathname)) return page;
  } catch { /* Record the reason even when a captured address cannot be shown. */ }
}

const genericName=/^(?:首页|网站首页|商店|商城|网络加速|商品列表|套餐价格|产品目录|AI 会员|AI API|模型网关|home|store|shop|pricing|products|plans|catalog)$/i;

function decide(row:Observation):Proof|Decision {
  const source=publicEvidence(row.proof_url);
  const description={id:row.candidate_id,source:source?.href,note:("本轮公开页面核查。"+row.reason).slice(0,420)};
  if (row.state==="rejected"||row.outcome==="non_merchant") return {...description,kind:"exclude"};
  if (row.outcome!=="merchant") {
    const resolution=row.outcome==="restricted"||row.outcome==="unavailable"?row.outcome:row.outcome==="redirect"?"redirected":"insufficient";
    return {...description,kind:"lead",resolution};
  }
  const evidence=JSON.parse(row.evidence??"null") as PageAssessment|null;
  const disposition=evidence?catalogSourceDisposition(evidence.title,evidence.description):undefined;
  if (disposition?.outcome==="non_merchant") return {...description,kind:"exclude",note:disposition.reason};
  if (disposition) return {...description,kind:"lead",resolution:"insufficient",note:disposition.reason};
  const publicPage=(JSON.parse(row.pages) as SourcePage[]).find(page=>page.outcome==="merchant"&&page.status&&page.status>=200&&page.status<300&&
    (page.finalUrl??page.url)===source?.href&&page.assessment?.basis===evidence?.basis);
  if (!publicPage||!source||source.pathname==="/"&&/^blog\./i.test(source.hostname)||websiteUrl(source.href).registrable!==row.registrable||!evidence?.basis||
    !evidence.category||!pipelineForCategory(evidence.category)||row.state==="known"||row.review_state==="published") {
    return {...description,kind:"lead",resolution:"insufficient",note:"未取得与独立注册域和服务类别同时对应的完整公开证据，保留页面来源。"};
  }
  const name=evidence.name?.trim();
  return {id:row.candidate_id,kind:"identity",name:name&&name.length>=2&&name.length<=55&&!genericName.test(name)?name:row.registrable,
    website:source.origin+"/",category:evidence.category,source:source.href,note:row.reason,date:row.checked_at.slice(0,10),checkout:evidence.checkout};
}

export function resolveMerchantBacklog(db:DatabaseSync,run:number,actor:string,apply=false) {
  const input=one<{campaign_id:number}>(db,"SELECT campaign_id FROM merchant_admission_runs WHERE id=?",run);
  if (!input) throw new Error("收录批次不存在。");
  const already=one<{id:number}>(db,"SELECT id FROM merchant_admission_runs WHERE reviewed_run_id=?",run);
  if (already) return {alreadyApplied:true,fromRun:run,run:already.id,...admissionStatistics(db,input.campaign_id,already.id)};
  const report=leadReviewReport(db,run,"backlog");
  if (!report.total||report.checked!==report.total) return {fromRun:run,ready:false,progress:report};
  const observations=all<Observation>(db,`SELECT r.*,c.registrable,c.state,i.state review_state FROM merchant_lead_reviews r
    JOIN merchant_admission_decisions p ON p.run_id=r.admission_run_id AND p.candidate_id=r.candidate_id
    JOIN merchant_candidates c ON c.id=r.candidate_id LEFT JOIN import_items i ON i.id=c.item_id
    WHERE r.admission_run_id=? AND r.checked_at IS NOT NULL AND p.outcome IN ('lead','conflict') AND p.resolved_as IS NULL ORDER BY r.candidate_id`,run);
  const provisional=observations.map(decide);
  const checkoutGroups=new Map<string,Proof[]>();
  for (const item of provisional) if (item.kind==="identity"&&item.checkout) {
    const group=checkoutGroups.get(item.checkout)??[];
    group.push(item);
    checkoutGroups.set(item.checkout,group);
  }
  const collisions=new Set([...checkoutGroups.values()].filter(group=>group.length>1).flatMap(group=>group.map(item=>item.id)));
  const decisions=provisional.map(item=>collisions.has(item.id)
    ?{id:item.id,kind:"hold",source:item.source,note:"多个候选的购买入口指向同一个外部地址，无法自动判定独立商家或重复收录。"}
    :item);
  return {fromRun:run,ready:true,progress:report,...merchantAdmission(db,input.campaign_id,decisions,actor,apply,{run,mode:"automatic"})};
}
