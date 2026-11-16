import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminNav,Notice,RecordForm,requireAdmin } from "@/components/directory/admin";
import { param,type Params } from "@/components/directory/catalog-page";
import { adminLabels,adminRecord,adminRows,submissionStates,type SubmissionState } from "@/lib/directory/admin-read";
import { entities,type Entity } from "@/lib/directory/write";

export const dynamic = "force-dynamic";
export const metadata:Metadata = {title:"编辑后台",robots:{index:false,follow:false}};
export default async function EntityPage({params,searchParams}:{params:Promise<{entity:string}>;searchParams:Promise<Params>}) {
  await requireAdmin();
  const slug=(await params).entity;
  const entity=entities.find((item)=>item===slug) as Entity | undefined;
  if (!entity) notFound();
  const input=await searchParams;
  const id=param(input.id).slice(0,90);
  const q=param(input.q).slice(0,100);
  const requested=param(input.state);
  const state=entity==="submissions"&&Object.hasOwn(submissionStates,requested)?requested as SubmissionState:"";
  const page=Math.min(10000,Math.max(1,Number.parseInt(param(input.page),10)||1));
  const rows=adminRows(entity,q,page,state);
  const record=id?adminRecord(entity,id):undefined;
  const base=`/admin/${entity}`;
  function listHref(target:number,targetId?:string) {
    const filters=new URLSearchParams({page:String(target),q});
    if (state) filters.set("state",state);
    if (targetId) filters.set("id",targetId);
    return `${base}?${filters}`;
  }
  return <div className="frame page admin-page">
    <div className="catalog-heading"><h1>{adminLabels[entity]}</h1></div><AdminNav/><Notice input={input}/>
    <div className="admin-layout"><div>
      <form action={base} className="field-stack"><label>查找记录<input type="search" name="q" maxLength={100} defaultValue={q}/></label>
        {entity==="submissions"&&<label>审核状态<select name="state" defaultValue={state}><option value="">全部状态</option>{Object.entries(submissionStates).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
        <button type="submit" className="button secondary">应用筛选</button>
      </form>
      <div className="admin-list">
        {entity!=="submissions"&&<Link href={listHref(page)}>新建{adminLabels[entity]}</Link>}
        {rows.slice(0,50).map((row)=><Link key={row.id??row.slug} href={listHref(page,String(row.id??row.slug))} aria-current={id===String(row.id??row.slug)?"page":undefined}>
          {row.id ? `#${row.id} · ` : ""}{row.display}{row.publication ? ` · ${row.publication}`:row.moderation?` · ${submissionStates[row.moderation as SubmissionState]}`:""}</Link>)}
        {!rows.length&&entity==="submissions"&&<p className="plain-empty">此筛选条件下暂无投稿。</p>}
      </div>
      <div className="pagination">{page>1&&<Link href={listHref(page-1)}>上一页</Link>}{rows.length>50&&<Link href={listHref(page+1)}>下一页</Link>}</div>
    </div>
      <div>{id&&!record?<p className="plain-empty">记录不存在或已被删除。</p>:<RecordForm key={`${entity}:${id}`} entity={entity} row={record}/>}
        {entity==="submissions"&&!!record?.publication_consent&&<form className="admin-form" method="post" action="/api/admin/manage">
          <input name="id" value={id} type="hidden"/>
          <label>复核过的商家公开官网<input name="source_url" type="url" defaultValue={String(record.url||"")} required/></label>
          <label className="wide"><span><input type="checkbox" required/> 已确认投稿人有权代表商家提交，官网链接属于该商家。</span></label>
          <button type="submit" name="action" value="merchant-intake" className="button secondary">转入采集管线</button>
        </form>}
        {entity==="sites"&&record&&<details className="admin-import-row"><summary>将重复档案并入此档案</summary>
          <form className="admin-form" method="post" action="/api/admin/manage">
            <input name="into" value={String(record.id)} type="hidden"/>
            <label>重复档案编号<input name="from" type="number" min="1" required/></label>
            <label className="wide"><span><input type="checkbox" required/> 已确认两个档案代表同一家商家</span></label>
            <button type="submit" name="action" value="merge" className="button secondary">合并档案</button>
          </form>
        </details>}
      </div>
    </div>
  </div>;
}
