import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav,Notice,requireAdmin } from "@/components/directory/admin";
import { param,type Params } from "@/components/directory/catalog-page";
import { all,directory } from "@/lib/directory/db";
import { conflicts,previewPage,sourceEvidence } from "@/lib/directory/imports";
import { pipelines,reachabilityLabels,type Pipeline } from "@/lib/directory/taxonomy";
import { coverageRuns,coverageTotals } from "@/lib/directory/coverage";

export const dynamic = "force-dynamic";
export const metadata:Metadata = {title:"批量导入",robots:{index:false,follow:false}};
const states={ready:"已发现 · 待审",failed:"失败",duplicate:"重复",approved:"已批准",published:"已发布"};
const accessLabels={licensed:"开放许可",official:"官网证据",submission:"授权投稿",restricted:"来源审计"};
export default async function Imports({searchParams}:{searchParams:Promise<Params>}) {
  await requireAdmin();
  const input=await searchParams;
  const id=Number(param(input.batch));
  const db=directory();
  const requested=param(input.state);
  const state=Object.hasOwn(states,requested)?requested:"";
  const page=Math.min(125,Math.max(1,Math.trunc(Number(param(input.page)))||1));
  const {rows,counts,size}=Number.isSafeInteger(id)&&id>0?previewPage(db,id,state,page):{rows:[],counts:[],size:40};
  const total=counts.reduce((sum,row)=>sum+row.n,0);
  const pages=Math.ceil((state?counts.find(row=>row.state===state)?.n??0:total)/size);
  const link=(n:number,filter=state)=>`/admin/imports?batch=${id}&state=${filter}&page=${n}`;
  const history=all<{id:number;format:string;created_at:string}>(db,"SELECT * FROM import_batches ORDER BY id DESC LIMIT 30");
  const runs=coverageRuns(db);
  const totals=coverageTotals(runs);
  const pipeline=param(input.pipeline);
  const selected=runs.filter(run=>!pipeline||run.pipeline===pipeline);
  return <div className="frame page admin-page admin-import"><div className="catalog-heading"><h1>批量导入</h1><p>CSV、JSON 或逐行 URL。待审档案须核对官网、简介和分类后才能批准。</p></div><AdminNav/><Notice input={input}/>
    <form className="admin-form" action="/api/admin/manage" method="post">
      <label>导入格式<select name="format"><option value="urls">逐行 URL</option><option value="csv">CSV</option><option value="json">JSON</option></select></label>
      <label className="wide">导入内容<textarea name="payload" rows={5} required maxLength={8000000}/><small>每批最多 5,000 条、8 MB。CSV 首行含 url，可附 name、summary、category、source_url、source_title、excerpt。JSON 可附获准使用的公开 HTML（html），页面标题和描述供人工核查。文件导入及官网检查可使用命令行。</small></label>
      <div className="form-buttons"><button name="action" value="import" type="submit" className="button primary">生成导入预览</button></div>
    </form>
    <section><h2>采集覆盖统计</h2><div className="compare-scroll"><table className="compare-table">
      <thead><tr><th scope="col">管线</th><th scope="col">发现</th><th scope="col">去重后</th><th scope="col">许可受限</th><th scope="col">可发布</th><th scope="col">已发布</th></tr></thead>
      <tbody>{totals.map(row=><tr key={row.pipeline}><th scope="row"><Link href={`/admin/imports?pipeline=${row.pipeline}`}>{pipelines[row.pipeline as Pipeline].label}</Link></th>
        <td>{row.discovered}</td><td>{row.deduplicated}</td><td>{row.restricted}{row.unknown_restricted_sources>0&&` + ${row.unknown_restricted_sources} 个来源未清点`}</td>
        <td>{row.publishable}</td><td>{row.published}</td></tr>)}</tbody>
    </table></div>
    {pipeline&&<Link href="/admin/imports">查看全部来源</Link>}
    {selected.slice(0,30).map(run=><p key={run.id}>{run.source_name} · {accessLabels[run.access]} · {run.discovered} 条{run.advertised!==null&&` · 源站规模 ${run.advertised}`}{run.reason&&` · ${run.reason}`} · <a href={run.evidence_url}>依据</a>{run.batch_id&&<> · <Link href={`/admin/imports?batch=${run.batch_id}`}>查看批次 #{run.batch_id}</Link></>}</p>)}
    </section>
    <details><summary>按采集管线导入或登记受限来源</summary>
      <form className="admin-form" action="/api/admin/manage" method="post">
        <label>采集管线<select name="pipeline">{Object.entries(pipelines).map(([key,item])=><option key={key} value={key}>{item.label}</option>)}</select></label>
        <label>使用依据<select name="access"><option value="licensed">明确允许复用的数据</option><option value="official">逐条查阅官网</option><option value="submission">商家自行提交</option><option value="restricted">受限来源审计</option></select></label>
        <label>来源名称<input name="source_name" maxLength={180} required/></label>
        <label>来源网址<input name="source_url" type="url" maxLength={1500} required/></label>
        <label>许可或核验依据网址<input name="evidence_url" type="url" maxLength={1500} required/></label>
        <label>来源声称规模<input name="advertised" type="number" min="0"/></label>
        <label>确认受限条数<input name="blocked" type="number" min="0"/></label>
        <label>格式<select name="format"><option value="json">JSON</option><option value="csv">CSV</option><option value="urls">逐行 URL</option></select></label>
        <label className="wide">使用范围或限制说明<input name="reason" maxLength={700}/></label>
        <label className="wide">条目内容<textarea name="payload" rows={5} maxLength={8000000}/></label>
        <button name="action" value="coverage-import" className="button primary">保存来源及预览</button>
      </form>
    </details>
    <div className="child-categories">{history.map((row)=><Link key={row.id} href={`/admin/imports?batch=${row.id}`}>批次 #{row.id} · {row.format}</Link>)}</div>
    {id>0&&<><h2>批次 #{id} · {total} 条</h2>
      <nav className="child-categories" aria-label="导入状态"><Link href={link(1,"")}>全部</Link>{counts.map(row=><Link key={row.state} href={link(1,row.state)}>{states[row.state]} {row.n}</Link>)}</nav>
      {rows.length===0&&<p>当前筛选没有记录。</p>}
    </>}
    {rows.some(row=>row.state==="ready")&&<form id="batch-approve" action="/api/admin/manage" method="post" className="child-categories">
      <input type="hidden" name="batch" value={id}/><button name="action" value="approve-selected" type="submit" className="button secondary">批准所选已核对档案</button>
    </form>}
    {rows.map((row)=><div key={row.id} className="admin-import-row">
      {row.state==="ready"&&<label className="import-pick"><input type="checkbox" form="batch-approve" name={`select_${row.id}`} value="1"/> 选择 #{row.id}</label>}
      <details open={row.state==="failed"}><summary>#{row.id} · {row.domain || "无效网址"} · {states[row.state]} {row.message}</summary>
      <p>{reachabilityLabels[row.reachability]}{row.checked_at&&` · ${row.checked_at.slice(0,10)}`}{row.check_detail&&` · ${row.check_detail}`}</p>
      {row.final_url&&<p>检查终点：{row.final_url}</p>}
      {sourceEvidence(db,row.id).map(source=><p key={source.source_url}>{source.acquired_at} · <a href={source.source_url} rel="noopener noreferrer">{source.source_name}</a>{source.license_url&&<> · <a href={source.license_url} rel="noopener noreferrer">数据许可</a></>}</p>)}
      {conflicts(db,row).map(conflict=><p key={`${conflict.domain}:${conflict.site_id}`}>请确认是否同一商家：{conflict.name} · {conflict.domain}{conflict.site_id&&<> · <Link href={`/admin/sites?id=${conflict.site_id}`}>已登记档案 #{conflict.site_id}</Link></>}</p>)}
      {row.state==="published"?<p>已建立服务商档案 #{row.site_id}</p>:<form className="admin-form" action="/api/admin/manage" method="post">
        <input type="hidden" name="batch" value={row.batch_id}/><input type="hidden" name="row" value={row.id}/>
        <label className="wide">审核资料 #{row.id}<textarea name="payload" rows={10} defaultValue={JSON.stringify(JSON.parse(row.payload),null,2)} required/></label>
        <p className="wide">简介与来源摘录由人核对。编辑摘要草稿须手动复核后才能写入简介。</p>
        {(row.state==="ready"||row.state==="approved")&&<label className="wide">暂缓理由（选填）<input name="reason" maxLength={250}/></label>}
        <div className="form-buttons">
          <button name="action" value="retry" type="submit" className="button secondary">保存并重试</button>
          <button name="action" value="approve" type="submit" className="button primary">确认并批准</button>
          {(row.state==="ready"||row.state==="approved")&&<button name="action" value="hold" type="submit" className="button secondary">暂缓审核</button>}
          {process.env.EDITOR_AI_ENDPOINT && <button name="action" value="ai" type="submit" className="button secondary">生成摘要草稿</button>}
        </div>
      </form>}
    </details></div>)}
    {pages>1&&<nav aria-label="导入分页" className="child-categories">{page>1&&<Link href={link(page-1)}>上一页</Link>}<span>第 {page} / {pages} 页</span>{page<pages&&<Link href={link(page+1)}>下一页</Link>}</nav>}
    {!!counts.some(({state})=>state==="approved")&&<form action="/api/admin/manage" method="post" className="child-categories">
      <input type="hidden" name="batch" value={id}/><button name="action" value="publish" type="submit" className="button primary">发布全部已批准档案</button>
    </form>}
  </div>;
}
