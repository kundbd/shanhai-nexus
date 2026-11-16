import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav,Notice,requireAdmin } from "@/components/directory/admin";
import { param,type Params } from "@/components/directory/catalog-page";
import { all,directory,one } from "@/lib/directory/db";
import { deepSeekSearchUsage,discoveryJobs,discoverySources,type Job } from "@/lib/directory/discovery";
import { pipelines } from "@/lib/directory/taxonomy";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"商家发现管理",robots:{index:false}};
const workflow={queued:"等待执行",running:"执行中",ok:"完成",partial:"部分完成",failed:"失败"};
export default async function Discovery({searchParams}:{searchParams:Promise<Params>}) {
  await requireAdmin();
  const input=await searchParams;
  const db=directory();
  const sources=discoverySources(db);
  const jobs=discoveryJobs(db);
  const deepSeek=deepSeekSearchUsage(db);
  const selected=sources.find(source=>String(source.id)===param(input.source));
  const selectedJob=one<Job>(db,"SELECT * FROM discovery_jobs WHERE id=?",Number(param(input.job))||0);
  const page=Math.max(1,Math.min(100,Math.floor(Number(param(input.page)))||1));
  const hits=selectedJob?all<{id:number;url:string;domain:string;evidence_url:string;query:string;decision:string;reason:string}>(db,
    "SELECT * FROM discovery_hits WHERE job_id=? ORDER BY id LIMIT 51 OFFSET ?",selectedJob.id,(page-1)*50):[];
  return <div className="frame page admin-page"><div className="catalog-heading"><h1>商家发现</h1><p>来源许可、任务历史与候选审核。搜索结果先保存出处，由编辑批准后进入公开目录。</p></div>
    <AdminNav/><Notice input={input}/>
    <div className="child-categories"><Link href="/admin/campaigns">批量采集任务</Link><Link href="/admin/imports">候选池与分类统计</Link><a href="/api/admin/discovery-export?format=csv">导出档案 CSV</a><a href="/api/admin/discovery-export?format=json">导出档案 JSON</a><a href="/api/admin/discovery-export?kind=candidates&format=csv">导出候选 CSV</a></div>
    {sources.some(source=>source.kind==="deepseek")&&<p>DeepSeek Search · 今日已占用 {deepSeek.used} / {deepSeek.limit} 次（UTC）</p>}
    <h2>发现来源</h2>
    <div className="child-categories"><Link href="/admin/discovery">新增来源</Link>{sources.map(source=><Link key={source.id} href={`/admin/discovery?source=${source.id}`}>{source.name}</Link>)}</div>
    <form key={selected?.id??"new"} className="admin-form" action="/api/admin/manage" method="post">
      <label>来源编号<input name="key" defaultValue={selected?.key} readOnly={!!selected} required/></label>
      <label>名称<input name="name" defaultValue={selected?.name} required/></label>
      <label>采集管线<select name="pipeline" defaultValue={selected?.pipeline??"ai-retail"}>{Object.entries(pipelines).map(([key,value])=><option key={key} value={key}>{value.label}</option>)}</select></label>
      <label>发现方式<select name="kind" defaultValue={selected?.kind??"page"}><option value="brave">Brave Search API</option><option value="deepseek">DeepSeek Search API</option><option value="page">允许访问的公开链接页</option>
        <option value="sitemap">商家官网 Sitemap</option><option value="dataset">已授权 JSON 名单</option><option value="manual">本地授权名单</option></select></label>
      <label>使用范围<select name="access" defaultValue={selected?.access??"restricted"}><option value="restricted">仅记录限制</option><option value="leads">仅可发现</option>
        <option value="official">官网公开资料</option><option value="licensed">已取得复用许可</option></select></label>
      <label>来源网址<input name="url" type="url" defaultValue={selected?.url} required/></label>
      <label>许可或复核网址<input name="evidence_url" type="url" defaultValue={selected?.evidence_url} required/></label>
      <label>计划间隔（小时）<input name="interval_hours" type="number" min={1} max={720} defaultValue={selected?.interval_hours??168} required/></label>
      <label className="wide">访问、授权与使用说明<textarea name="notes" defaultValue={selected?.notes} maxLength={800} required/></label>
      <label><span><input type="checkbox" name="enabled" value="1" defaultChecked={!!selected?.enabled}/> 启用定时任务</span></label>
      <button className="button primary" name="action" value="discovery-save">保存来源</button>
    </form>
    {selected&&selected.access!=="restricted"&&selected.kind!=="manual"&&<form method="post" action="/api/admin/manage" className="child-categories">
      <input type="hidden" name="id" value={selected.id}/><button className="button secondary" name="action" value="discovery-queue">加入执行队列</button>
      {selected.enabled===1&&<span>下一次计划 {selected.next_run_at.slice(0,16).replace("T"," ")} UTC</span>}
    </form>}
    <h2>最近任务</h2>
    {jobs.length===0&&<p>暂无发现任务。</p>}
    {jobs.map(job=><p key={job.id}><Link href={`/admin/discovery?job=${job.id}`}>#{job.id} {job.source_name}</Link> · {workflow[job.state]} · 来源返回 {job.received} · 新候选 {job.candidates} · 重复 {job.duplicates} · 暂缓 {job.held}
      {job.batch_id&&<> · <Link href={`/admin/imports?batch=${job.batch_id}`}>打开审核批次</Link></>}</p>)}
    {selectedJob&&<section><h2>任务 #{selectedJob.id}</h2>
      <ul>{(JSON.parse(selectedJob.errors) as string[]).map(error=><li key={error}>{error}</li>)}</ul>
      {["failed","partial"].includes(selectedJob.state)&&JSON.parse(selectedJob.source_snapshot).kind!=="manual"&&<form method="post" action="/api/admin/manage" className="child-categories">
        <input type="hidden" name="id" value={selectedJob.id}/><button className="button secondary" name="action" value="discovery-retry">重试任务</button>
      </form>}
      {!hits.length&&<p>当前任务没有有效网址记录。</p>}
      {hits.slice(0,50).map(hit=><p key={hit.id}>{hit.domain} · {hit.reason}{hit.query&&` · ${hit.query}`} · <a href={hit.evidence_url} rel="noreferrer">发现来源</a></p>)}
      <nav className="child-categories" aria-label="发现记录分页">{page>1&&<Link href={`?job=${selectedJob.id}&page=${page-1}`}>上一页</Link>}
        {hits.length>50&&<Link href={`?job=${selectedJob.id}&page=${page+1}`}>下一页</Link>}</nav>
    </section>}</div>;
}
