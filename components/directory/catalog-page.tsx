import Link from "next/link";
import { directoryStats,listCategories, listSites } from "@/lib/directory/read";
import type { Category } from "@/lib/directory/types";
import { day,SiteTable } from "./display";
import { categoryGroups,operators,publicLifecycleLabels,reachabilityLabels } from "@/lib/directory/taxonomy";

export type Params = Record<string, string | string[] | undefined>;
export const param = (value: string | string[] | undefined) => typeof value === "string" ? value : "";

const groupLabels: Record<string,string> = { priority:"重点类别", "ai-retail":"AI 代充与卡网", connections:"机场与 VPN", all:"全部服务" };
const catalogStatuses:Record<string,string>={priced:"有公开报价",unpriced:"暂无公开报价","product-observed":"有公开商品"};

export function CatalogPage({ input, fixed }: { input: Params; fixed?: Category }) {
  const categories = listCategories();
  const base = fixed ? `/categories/${fixed.slug}` : "/services";
  const q = param(input.q).trim().slice(0,160);
  const filter = fixed?.slug ?? param(input.category);
  const category = categories.find((item)=>item.slug === filter)?.slug ?? "";
  const requestedStatus=param(input.status);
  const status = Object.hasOwn(catalogStatuses,requestedStatus)?requestedStatus:"";
  const requestedGroup = param(input.group);
  const group = !fixed && !category ? Object.hasOwn(categoryGroups,requestedGroup) ? requestedGroup : !q&&requestedGroup!=="all" ? "priority" : "" : "";
  const reachability = param(input.reachability);
  const operator = param(input.operator);
  const lifecycle = ["current","closed"].includes(param(input.lifecycle)) ? param(input.lifecycle) : "";
  const rawSort = param(input.sort);
  const sort = ["recent","name","relevance"].includes(rawSort) ? rawSort : q ? "relevance" : "recent";
  const page = Math.min(100_000,Math.max(1,parseInt(param(input.page),10) || 1));
  const { rows,total,page:current,size,priceMatches } = listSites({q,category,group,status,operator,reachability,lifecycle,sort,page});
  const stats=directoryStats({category,group});
  const pages = Math.max(1,Math.ceil(total/size));
  const selected = [
    q && `关键词：${q}`,
    !fixed && category && `分类：${categories.find((item)=>item.slug===category)?.label ?? category}`,
    !fixed && requestedGroup && requestedGroup!=="all" && group && groupLabels[group],
    !fixed && requestedGroup==="all" && "全部服务",
    Object.hasOwn(catalogStatuses,status) && catalogStatuses[status],
    sort !== (q ? "relevance" : "recent") && `排序：${sort==="name"?"按名称":sort==="relevance"?"按相关度":"最近更新"}`,
    reachability && Object.hasOwn(reachabilityLabels,reachability) && `检查记录：${reachabilityLabels[reachability as keyof typeof reachabilityLabels]}`,
    operator && Object.hasOwn(operators,operator) && `运营性质：${operators[operator as keyof typeof operators]}`,
    lifecycle==="current" && publicLifecycleLabels.active,
    lifecycle==="closed" && "已停运",
  ].filter((item): item is string => Boolean(item));
  const moreOpen = Boolean(reachability || operator || lifecycle);
  function pageHref(target: number) {
    const params = new URLSearchParams();
    if (q) params.set("q",q);
    if (category && !fixed) params.set("category",category);
    if (group || requestedGroup==="all") params.set("group",group || "all");
    if (reachability) params.set("reachability",reachability);
    if (operator) params.set("operator",operator);
    if (lifecycle) params.set("lifecycle",lifecycle);
    if (Object.hasOwn(catalogStatuses,status)) params.set("status",status);
    params.set("sort",sort);
    if (target > 1) params.set("page",String(target));
    return `${base}?${params}`;
  }
  return <div className="frame page directory-page">
    {fixed && <div className="crumbs"><Link href="/services">服务目录</Link><span>/</span>{fixed.label}</div>}
    <div className="catalog-heading"><h1>{fixed?.label ?? "服务目录"}</h1><p>{fixed?.description ?? "按分类、商家名称、官网域名或公开商品查找服务档案。"}</p></div>
    <p className="catalog-count">公开 {stats.total} 家 · 有公开报价 {stats.priced} 家{stats.last&&` · 最近更新 ${day(stats.last)}`}</p>
    {fixed && categories.some((item)=>item.parent_slug === fixed.slug) && <nav className="child-categories" aria-label="子分类">{categories.filter((item)=>item.parent_slug === fixed.slug).map((item)=><Link key={item.slug} href={`/categories/${item.slug}`}>{item.label}</Link>)}</nav>}
    {!fixed && <nav className="child-categories" aria-label="重点目录"><Link href="/services?group=priority">重点类别</Link><Link href="/services?group=ai-retail">AI 代充与卡网</Link><Link href="/services?group=connections">机场与 VPN</Link><Link href="/services?group=all">全部服务</Link></nav>}
    <form key={JSON.stringify([q,category,group,status,operator,reachability,lifecycle,sort])} className="catalog-filters" action={base}>
      {(requestedGroup||!q)&&!fixed && <input type="hidden" name="group" value={requestedGroup||""}/>}
      <label>名称或关键词<input name="q" type="search" maxLength={160} defaultValue={q} placeholder="例如 OpenRouter、模型聚合" /></label>
      {!fixed && <label>分类<select name="category" defaultValue={category}><option value="">全部分类</option>{categories.map((item)=><option key={item.slug} value={item.slug}>{item.parent_slug?"　":""}{item.label}</option>)}</select></label>}
      <label>收录内容<select name="status" defaultValue={status}><option value="">全部档案</option>{Object.entries(catalogStatuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>排序<select name="sort" defaultValue={sort}><option value="recent">最近更新</option><option value="name">按名称</option><option value="relevance">按相关度</option></select></label>
      <button className="button primary" type="submit">应用筛选</button>
      <details className="more-filters" open={moreOpen}>
        <summary>更多筛选</summary>
        <div className="more-filter-grid">
          <label>官网检查记录<select name="reachability" defaultValue={reachability}><option value="">全部记录</option>{Object.entries(reachabilityLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <label>运营性质<select name="operator" defaultValue={operator}><option value="">全部性质</option>{Object.entries(operators).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <label>运营状态<select name="lifecycle" defaultValue={lifecycle}><option value="">全部</option><option value="current">{publicLifecycleLabels.active}</option><option value="closed">{publicLifecycleLabels.closed}</option></select></label>
        </div>
      </details>
    </form>
    {!!selected.length && <p className="filter-chips">已选：{selected.map((item)=><span key={item}>{item}</span>)} <Link href={base}>清除筛选</Link></p>}
    <p className="catalog-count">{total} 个匹配档案 <Link href="/policy#evidence">收录说明</Link> · <Link href="/contact?submit=merchant">提交商家</Link></p>
    {rows.length ? <SiteTable sites={rows} priceMatches={priceMatches} query={q}/> : <div className="plain-empty boxed-empty"><h2>没有匹配的档案</h2><p>试试简短名称、官网域名或放宽筛选。</p><Link className="text-link" href={base}>清除筛选</Link></div>}
    {pages > 1 && <nav className="pagination" aria-label="目录分页">
      {current > 1 && <Link href={pageHref(current-1)}>上一页</Link>}<span>第 {current} / {pages} 页</span>{current < pages && <Link href={pageHref(current+1)}>下一页</Link>}
    </nav>}
  </div>;
}

