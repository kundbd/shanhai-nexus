import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav,Notice,requireAdmin } from "@/components/directory/admin";
import { CampaignRefresh } from "@/components/directory/campaign-refresh";
import { param,type Params } from "@/components/directory/catalog-page";
import { all,directory,one } from "@/lib/directory/db";
import { merchantCampaignReport } from "@/lib/directory/merchant-campaign";
import { admissionStatistics } from "@/lib/directory/merchant-admission";
import type { MerchantProof } from "@/lib/directory/merchant-evidence";
import { leadReviewReport } from "@/lib/directory/merchant-lead-review";
import { directoryRefreshStatus } from "@/lib/directory/refresh-state";
import { merchantSourceReport } from "@/lib/directory/merchant-source-intake";
import { pipelines,type Pipeline } from "@/lib/directory/taxonomy";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"批量商家采集",robots:{index:false}};
const labels:Record<string,string>={running:"运行中",paused:"已暂停",blocked:"搜索已停止",queued:"待执行",done:"完成",failed:"失败",
  checking:"核查中",known:"已有档案",filtered:"已筛除",unverified:"核查失败",manual:"需人工核查",ready:"有官网证据",rejected:"已拒绝",
  approved:"已批准",duplicate:"重复",published:"已发布"};
const price=(milli:number)=>`¥${(milli/1000).toFixed(3)}`;
const outcomes:Record<string,string>={verified:"已核实",basic:"资料待核实",duplicate:"归并已有档案",conflict:"待人工复核",excluded:"本轮排除",lead:"尚待处理",
  unavailable:"本轮未连接 · 已留档",restricted:"访问受限 · 已留档",insufficient:"公开证据不足 · 已留档",redirected:"入口转发 · 已留档"};

export default async function Campaigns({searchParams}:{searchParams:Promise<Params>}) {
  await requireAdmin();
  const input=await searchParams;
  const db=directory();
  const refresh=directoryRefreshStatus(db).latest;
  const campaigns=all<{id:number;name:string}>(db,"SELECT id,name FROM merchant_campaigns ORDER BY id DESC LIMIT 30");
  const id=Number(param(input.id))||campaigns[0]?.id;
  const selected=campaigns.some(row=>row.id===id)?merchantCampaignReport(db,id!):null;
  const state=param(input.state);
  const page=Math.max(1,Math.min(1000,Math.floor(Number(param(input.page)))||1));
  const admission=param(input.admission);
  const intake=selected?admissionStatistics(db,selected.campaign.id):null;
  const lastReview=intake?.runId?one<{reviewed_run_id:number|null}>(db,"SELECT reviewed_run_id FROM merchant_admission_runs WHERE id=?",intake.runId):null;
  const reviewProgress=intake?.runId?leadReviewReport(db,lastReview?.reviewed_run_id??intake.runId,"backlog"):null;
  const manual=intake?.outcomes.find(row=>row.outcome==="conflict")?.n??0;
  const candidates=selected?all<{id:number;registrable:string;state:string;reason:string;details:string;batch_id:number;review:string;outcome:string|null;decision:string|null;decision_source:string|null}>(db,
    `SELECT c.*,i.batch_id,i.state review,coalesce(a.resolved_as,a.outcome) outcome,a.reason decision,json_extract(a.evidence,'$.source') decision_source FROM merchant_candidates c LEFT JOIN import_items i ON i.id=c.item_id
      LEFT JOIN merchant_admission_decisions a ON a.candidate_id=c.id AND a.run_id=?
      WHERE c.campaign_id=? AND (?='' OR c.state=?) AND (?='' OR coalesce(a.resolved_as,a.outcome)=?) ORDER BY c.id DESC LIMIT 41 OFFSET ?`,
    intake?.runId??null,selected.campaign.id,state,state,admission,admission,(page-1)*40):[];
  const pageLink=(target:number)=>`/admin/campaigns?${new URLSearchParams({id:String(id),state,admission,page:String(target)})}`;
  const requests=selected?.requests as {state:string;count:number;reserved_milli:number}[]|undefined;
  const counts=selected?.candidates as {pipeline:Pipeline;state:string;review_state:string;count:number}[]|undefined;
  const queries=selected?.queries as {pipeline:Pipeline;state:string;count:number}[]|undefined;
  const publicCounts=selected?.published as {category_slug:string;count:number}[]|undefined;
  const urlCounts=selected?.urls as {occurrences:number;unique_urls:number;filtered:number}|undefined;
  const issues=selected?.errors as {error:string;count:number}[]|undefined;
  const sources=selected?merchantSourceReport(db,selected.campaign.id):[];
  const sourceIssues=selected?all<{id:number;name:string;state:string;error:string}>(db,`SELECT id,json_extract(source_snapshot,'$.name') name,state,error
    FROM merchant_source_runs WHERE campaign_id=? AND error<>'' ORDER BY id DESC LIMIT 40`,selected.campaign.id):[];
  return <div className="frame page admin-page"><div className="catalog-heading"><h1>批量商家采集</h1><p>搜索请求、官网证据和发布结果均来自数据库。</p></div>
    <AdminNav/><Notice input={input}/><div className="child-categories"><Link href="/admin/discovery">发现来源</Link><Link href="/admin/imports">批量审核</Link>{campaigns.map(row=><Link key={row.id} href={`/admin/campaigns?id=${row.id}`}>{row.name}</Link>)}</div>
    <section aria-labelledby="refresh-status"><h2 id="refresh-status">五小时目录刷新</h2>{refresh?<>
      <p>第 {refresh.id} 轮 · {refresh.done}/{refresh.targets} 个档案或报价来源 · 核实报价 {refresh.quotesChecked} 项 · 价格变更 {refresh.quotesChanged} 项</p>
      <p>DeepSeek {refresh.search} · 预留 {price(refresh.reservedMilli)} · 预计计费 {price(refresh.billableMilli)}{refresh.searchError&&` · ${refresh.searchError}`}</p>
      {refresh.rateDay&&<p>参考汇率日期 {refresh.rateDay}</p>}{(refresh.error||refresh.rateError)&&<p>{refresh.error||refresh.rateError}</p>}
    </>:<p>暂无刷新记录</p>}</section>
    <form className="admin-form" method="post" action="/api/admin/manage">
      <label>采集任务名称<input name="name" maxLength={100} required/></label>
      <label>费用上限（元）<input name="budget" type="number" min="0.005" max="10" step="0.005" defaultValue="10" required/></label>
      <button name="action" value="campaign-create" className="button secondary">创建采集任务</button>
    </form>
    {selected&&<section><h2>{selected.campaign.name}</h2>
      {(selected.campaign.state==="running"||(reviewProgress?.active??0)>0)&&<CampaignRefresh/>}
      <p>{labels[selected.campaign.state]}{selected.campaign.pause_reason&&` · ${selected.campaign.pause_reason}`}</p>
      <p>公开目录 {publicCounts?.reduce((sum,row)=>sum+row.count,0)} 家 · 搜索请求 {requests?.reduce((sum,row)=>sum+row.count,0)} 次 · 
        估算已计费 {price(requests?.find(row=>row.state==="billable")?.reserved_milli??0)} · 已保守预留 {price(requests?.reduce((sum,row)=>sum+row.reserved_milli,0)??0)} / {price(selected.campaign.budget_milli)}</p>
      <p>发现网址 {urlCounts?.unique_urls} · 过滤网址记录 {urlCounts?.filtered} · 唯一注册域 {counts?.reduce((sum,row)=>sum+row.count,0)}</p>
      {intake?.runId&&<p>公开商家档案 {intake.publicCounts.total} 家 · 已核实 {intake.publicCounts.verified} 家 · 资料待核实 {intake.publicCounts.pending} 家 · 尚待处理 {intake.pendingCandidates-manual} 条 · 人工复核 {manual} 条 · 本轮新增 {intake.added} 家</p>}
      {!!reviewProgress?.total&&(reviewProgress.checked>0||reviewProgress.active>0)&&<p>本轮逐条核查 {reviewProgress.checked} / {reviewProgress.total} · {intake?.archived??0} 条已留档</p>}
      <details><summary>分类覆盖、查询状态与核查状态</summary>
        <ul>{publicCounts?.map(row=><li key={row.category_slug}>{row.category_slug} · 公开 {row.count} 家</li>)}</ul>
        <ul>{queries?.map(row=><li key={`${row.pipeline}:${row.state}`}>{pipelines[row.pipeline].label} · 查询{labels[row.state]} · {row.count}</li>)}</ul>
        <ul>{counts?.map(row=><li key={`${row.pipeline}:${row.state}:${row.review_state}`}>{pipelines[row.pipeline].label} · {labels[row.state]}{row.review_state&&` · ${labels[row.review_state]}`} · {row.count}</li>)}</ul>
      </details>
      {!!issues?.length&&<details><summary>搜索请求错误</summary><ul>{issues.map(row=><li key={row.error}>{row.error} · {row.count}</li>)}</ul></details>}
      {!!sources.length&&<details><summary>来源贡献与核查结果</summary><ul>{sources.map(row=><li key={row.source}>{row.source} · 唯一域名 {row.domains} · 首次入池 {row.novel} · 核对官网 {row.verified}/{row.checked} · 首来源发布 {row.published_first_source}</li>)}</ul></details>}
      {!!sourceIssues.length&&<details><summary>来源限制与失败记录</summary><ul>{sourceIssues.map(row=><li key={row.id}>{row.name} · {row.error}</li>)}</ul></details>}
      <form method="post" action="/api/admin/manage" className="child-categories">
        <input type="hidden" name="id" value={id}/>
        {selected.campaign.state==="running"?<button name="action" value="campaign-pause" className="button secondary">暂停采集</button>:<button name="action" value="campaign-resume" className="button secondary">启用采集</button>}
        <button name="action" value="campaign-stage" className="button secondary">生成审核批次</button>
        <a href={`/api/admin/discovery-export?kind=campaign&campaign=${id}&format=csv`}>导出 CSV</a><a href={`/api/admin/discovery-export?kind=campaign&campaign=${id}`}>导出 JSON</a>
      </form>
      <form method="post" action="/api/admin/manage" className="admin-form">
        <input type="hidden" name="id" value={id}/><label>候选编号（逗号分隔）<input name="ids" maxLength={4000} required/></label>
        <label>拒绝理由<input name="reason" maxLength={200} required/></label><button className="button secondary" name="action" value="campaign-reject">批量拒绝</button>
      </form>
      <form action="/admin/campaigns" className="child-categories"><input type="hidden" name="id" value={id}/><label>核查状态 <select name="state" defaultValue={state}>
        <option value="">全部</option>{["queued","checking","ready","unverified","filtered","manual","known","rejected"].map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label>
        {intake?.runId&&<label>收录结果 <select name="admission" defaultValue={admission}><option value="">全部</option>{Object.entries(outcomes).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>}
        <button className="button secondary">筛选</button></form>
      {candidates.slice(0,40).map(row=>{const proof=JSON.parse(row.details) as Partial<MerchantProof>;return <details key={row.id}>
        <summary>#{row.id} {proof.name||row.registrable} · {row.outcome?outcomes[row.outcome]:labels[row.state]}{row.review==="published"&&" · 已发布"}</summary>
        {row.decision&&<p>{row.decision}</p>}
        {row.decision_source&&/^https?:\/\//i.test(row.decision_source)&&<p><a href={row.decision_source} rel="noreferrer">本轮复核来源</a></p>}
        {row.reason&&<p>原核查结果 · {row.reason}</p>}
        {proof.url&&<p><a href={proof.url} rel="noreferrer">官网证据</a> · {proof.excerpt}</p>}
        {proof.payments&&<p>页面提及的付款词 · {proof.payments}</p>}
        {!!proof.prices?.length&&<ul>{proof.prices.map((row,index)=><li key={index}>{row.product} · {row.amount} {row.currency} · 周期 {row.period||"暂无数据"} · 待编辑确认</li>)}</ul>}
        {row.batch_id&&<Link href={`/admin/imports?batch=${row.batch_id}`}>审核批次 #{row.batch_id}</Link>}
      </details>;})}
      <nav className="child-categories" aria-label="候选分页">{page>1&&<Link href={pageLink(page-1)}>上一页</Link>}{candidates.length>40&&<Link href={pageLink(page+1)}>下一页</Link>}</nav>
    </section>}
  </div>;
}
