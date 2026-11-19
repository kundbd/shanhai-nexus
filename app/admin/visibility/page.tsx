import type { Metadata } from "next";
import Link from "next/link";
import { Notice, requireAdmin } from "@/components/directory/admin";
import { param, type Params } from "@/components/directory/catalog-page";
import { directory } from "@/lib/directory/db";
import { savedVisibility, visibilityTarget, visibilityTargets } from "@/lib/geo/admin";
import { visibilityModes } from "@/lib/geo/policy";
import { visibilityKinds, type VisibilityKind } from "@/lib/geo/visibility";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {title:"地区可见性",robots:{index:false,follow:false}};
const base="/admin/visibility";

export default async function VisibilityAdmin({searchParams}:{searchParams:Promise<Params>}) {
  await requireAdmin();
  const input=await searchParams;
  const requested=param(input.kind);
  const kind:VisibilityKind=Object.hasOwn(visibilityKinds,requested)?requested as VisibilityKind:"guide";
  const q=param(input.q).slice(0,100);
  const page=Math.min(10000,Math.max(1,Number.parseInt(param(input.page),10)||1));
  const key=param(input.key).slice(0,1500);
  const db=directory();
  const rows=visibilityTargets(db,kind,q,page);
  const target=key ? visibilityTarget(db,kind,key) : undefined;
  const rule=target ? savedVisibility(db,kind,target.key) : undefined;
  function href(key?:string,nextPage=page) {
    const query=new URLSearchParams({kind});
    if (key) query.set("key",key);
    if (q) query.set("q",q);
    if (nextPage>1) query.set("page",String(nextPage));
    return `${base}?${query}`;
  }
  return <div className="frame page admin-page">
    <div className="catalog-heading"><h1>地区可见性</h1></div>
    <Notice input={input}/>
    <nav className="filter-pills" aria-label="地区配置对象">{Object.entries(visibilityKinds).map(([id,label])=>
      <Link key={id} href={`${base}?kind=${id}`} prefetch={false} aria-current={kind===id?"page":undefined}>{label}</Link>)}</nav>
    <div className="admin-layout">
      <div className="admin-record-picker">
        <form action={base} className="field-stack admin-record-filter">
          <input name="kind" type="hidden" value={kind}/>
          <label>查找内容<input name="q" type="search" defaultValue={q} maxLength={100}/></label>
          <button type="submit" className="button secondary">查找</button>
        </form>
        <div className="admin-list">{rows.slice(0,40).map(row=><Link key={row.key} href={href(row.key)} prefetch={false} aria-current={key===row.key?"page":undefined}>
          <strong>{row.label}</strong>
        </Link>)}{!rows.length&&<p className="plain-empty">暂无匹配内容。</p>}</div>
        {(page>1||rows.length>40)&&<nav className="pagination" aria-label="地区配置分页">
          {page>1&&<Link href={href(undefined,page-1)}>上一页</Link>}
          {rows.length>40&&<Link href={href(undefined,page+1)}>下一页</Link>}
        </nav>}
      </div>
      <div className="admin-record-panel">{(target || kind==="promotion")?<>
        <h2>{target?.label??"配置推广链接"}</h2>
        <form key={`${kind}:${target?.key??""}`} className="admin-form" method="post" action="/api/admin/manage">
          <input type="hidden" name="kind" value={kind}/>
          {kind==="promotion"?<label className="wide">推广链接<input name="key" type="url" required maxLength={1500} defaultValue={target?.key}/></label>
            :<input type="hidden" name="key" value={target?.key}/>}
          <label className="wide">地区可见性<select name="mode" defaultValue={rule?.mode??"all"}>
            {Object.entries(visibilityModes).filter(([value])=>!target?.network||value!=="cn").map(([value,label])=>
              <option key={value} value={value}>{target?.network&&value==="all"?"未开放":label}</option>)}
          </select></label>
          <label className="wide">指定国家或地区代码<input name="countries" placeholder="例如 HK, US" maxLength={1200} defaultValue={rule?.countries.join(", ")}/></label>
          {target?.network&&<p className="section-note wide">此项需要明确的境外规则。归档商家还需在服务商编辑页手动发布。</p>}
          <div className="form-buttons"><button name="action" value="region-visibility" className="button primary">保存地区可见性</button></div>
        </form>
      </>:<p className="plain-empty boxed-empty">选择一条内容修改可见范围。</p>}</div>
    </div>
  </div>;
}
