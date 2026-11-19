import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice,RecordForm,requireAdmin } from "@/components/directory/admin";
import { param,type Params } from "@/components/directory/catalog-page";
import { adminLabels,adminPublicationStates,adminRecord,adminRows,submissionStates,type SubmissionState } from "@/lib/directory/admin-read";
import { entities,type Entity } from "@/lib/directory/write";

export const dynamic = "force-dynamic";
export const metadata:Metadata = {title:"编辑后台",robots:{index:false,follow:false}};
export default async function EntityPage({params,searchParams}:{params:Promise<{entity:string}>;searchParams:Promise<Params>}) {
  await requireAdmin();
  const slug=(await params).entity;
  const entity=entities.find((item)=>item===slug) as Entity | undefined;
  if (!entity) notFound();
  const input=await searchParams;
  const explicit=param(input.id).slice(0,90);
  const q=param(input.q).slice(0,100);
  const requested=param(input.state);
  const submissions=entity==="submissions";
  const state=submissions&&requested!=="all"?(Object.hasOwn(submissionStates,requested)?requested as SubmissionState:"pending"):"";
  const page=Math.min(10000,Math.max(1,Number.parseInt(param(input.page),10)||1));
  const rows=adminRows(entity,q,page,state);
  const creating=!submissions&&!explicit&&param(input.new)==="1";
  const automatic=rows[0]&&(submissions||q&&rows.length===1)?String(rows[0].id??rows[0].slug):"";
  const id=explicit||(creating?"":automatic);
  const record=id?adminRecord(entity,id):undefined;
  const base=`/admin/${entity}`;
  const regionKind=entity==="sites"?"site":entity==="categories"?"category":entity==="editorials"?"editorial":undefined;
  const filters={q,state:submissions?state||"all":"",page};
  function listHref(target:number,targetId?:string,create=false) {
    const filters=new URLSearchParams();
    if (target>1) filters.set("page",String(target));
    if (q) filters.set("q",q);
    if (submissions) filters.set("state",state||"all");
    if (targetId) filters.set("id",targetId);
    if (create) filters.set("new","1");
    return filters.size?`${base}?${filters}`:base;
  }
  return <div className="frame page admin-page">
    <div className="catalog-heading admin-dashboard-heading"><h1>{adminLabels[entity]}</h1>
      {!submissions&&<Link href={listHref(page,undefined,true)} className="button primary" prefetch={false}>新建{adminLabels[entity]}</Link>}
    </div><Notice input={input}/>
    <div className="admin-layout">
      <div className="admin-record-picker">
        <form action={base} className="field-stack admin-record-filter">
          <label>查找记录<input type="search" name="q" maxLength={100} defaultValue={q} placeholder={entity==="sites"?"店名、域名或编号":submissions?"店名、域名或正文":undefined}/></label>
          {submissions&&<label>审核状态<select name="state" defaultValue={state||"all"}><option value="all">全部状态</option>
            {Object.entries(submissionStates).map(([key,label])=><option key={key} value={key}>{label}</option>)}
          </select></label>}
          <button type="submit" className="button secondary">查找</button>
        </form>
        <div className="admin-list">
          {rows.slice(0,50).map(row=>{
            const key=String(row.id??row.slug);
            const status=row.moderation?submissionStates[row.moderation as SubmissionState]:row.publication?adminPublicationStates[row.publication as keyof typeof adminPublicationStates]:undefined;
            return <Link key={key} href={listHref(page,key)} prefetch={false} aria-current={id===key?"page":undefined}>
              <div><strong>{row.display}</strong>
                {row.website&&<small>{row.website}</small>}</div>
              <div className="admin-list-meta">{row.id&&<small>#{row.id}</small>}
                {status&&<span className="admin-state" data-state={row.moderation??row.publication}>{status}</span>}</div>
            </Link>;
          })}
          {!rows.length&&<p className="plain-empty">当前筛选暂无记录。</p>}
        </div>
        {(page>1||rows.length>50)&&<nav className="pagination" aria-label="记录分页">
          {page>1&&<Link href={listHref(page-1)}>上一页</Link>}
          {rows.length>50&&<Link href={listHref(page+1)}>下一页</Link>}
        </nav>}
      </div>
      <div className="admin-record-panel">{record||creating?<>
        <h2>{record?.display??`新建${adminLabels[entity]}`}</h2>
        {record&&regionKind&&<Link className="text-link" href={`/admin/visibility?${new URLSearchParams({kind:regionKind,key:String(record.slug)})}`} prefetch={false}>地区可见性</Link>}
        <RecordForm key={`${entity}:${id}`} entity={entity} row={record} filters={filters} showAdvanced={Boolean(param(input.error))}/>
      </>:<p className="plain-empty boxed-empty">{explicit?"记录不存在或已被删除。":submissions?"暂无可审核的投稿。":"选择列表中的记录进行编辑。"}</p>}
        {submissions&&!!record?.publication_consent&&(record.batch_id?
          <Link className="text-link" href={`/admin/imports?batch=${record.batch_id}`}>查看导入批次</Link>:
          <details className="admin-fold"><summary>手动转入采集</summary>
            <form className="admin-form" method="post" action="/api/admin/manage">
              <input name="id" value={id} type="hidden"/>
              <label className="wide">复核过的商家公开官网<input name="source_url" type="url" defaultValue={String(record.url||"")} required/></label>
              <label className="wide"><span className="admin-confirm"><input type="checkbox" required/> 已确认投稿人有权代表商家提交，官网链接属于该商家。</span></label>
              <div className="form-buttons"><button type="submit" name="action" value="merchant-intake" className="button secondary">转入采集管线</button></div>
            </form>
          </details>)}
        {entity==="sites"&&record&&<details className="admin-fold"><summary>合并重复档案</summary>
          <form className="admin-form" method="post" action="/api/admin/manage">
            <input name="into" value={String(record.id)} type="hidden"/>
            <label>重复档案编号<input name="from" type="number" min="1" required/></label>
            <label className="wide"><span className="admin-confirm"><input type="checkbox" required/> 已确认两个档案代表同一家商家</span></label>
            <button type="submit" name="action" value="merge" className="button secondary">合并档案</button>
          </form>
        </details>}
      </div>
    </div>
  </div>;
}
