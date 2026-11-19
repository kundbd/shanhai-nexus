import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { directoryStats,listPublicCategories,listSites } from "@/lib/directory/read";
import { categoryHref,type Category } from "@/lib/directory/types";
import { day,SiteTable } from "./display";
import { categoryGroups,operators,publicCategorySlug,publicLifecycleLabels,reachabilityLabels } from "@/lib/directory/taxonomy";
import { contentVisibility } from "@/lib/geo/request";

export type Params = Record<string, string | string[] | undefined>;
export const param = (value: string | string[] | undefined) => typeof value === "string" ? value : "";

const groupLabels: Record<string,string> = { priority:"重点类别", "ai-retail":"AI 代充与卡网", connections:"网络服务", all:"全部服务" };
const catalogStatuses:Record<string,string>={priced:"有公开报价",unpriced:"暂无公开报价","product-observed":"有公开商品"};
const catalogSorts:Record<string,string>={
  recent:"最近更新",name:"按名称",relevance:"按相关度","price-asc":"价格从低到高","price-desc":"价格从高到低",
};

export async function CatalogPage({ input, fixed }: { input: Params; fixed?: Category }) {
  const t = await getTranslations();
  const visibility=await contentVisibility();
  const base = fixed ? categoryHref(fixed.slug) : "/services";
  const q = param(input.q).trim().slice(0,160);
  const filter = publicCategorySlug(fixed?.slug ?? param(input.category));
  const requestedGroup = param(input.group);
  const connections=categoryGroups.connections.some(category=>visibility.categoryAllowed(category));
  const categories = listPublicCategories(undefined,visibility);
  const category = categories.find((item)=>item.slug === filter)?.slug ?? "";
  if ((filter&&!category)||(!fixed&&requestedGroup==="connections"&&!connections)) notFound();
  const childCategories = fixed ? categories.filter(item =>
    item.slug!==fixed.slug && item.parent_slug && publicCategorySlug(item.parent_slug)===fixed.slug) : [];
  const requestedStatus=param(input.status);
  const status = Object.hasOwn(catalogStatuses,requestedStatus)?requestedStatus:"";
  const group = !fixed && !category ? Object.hasOwn(categoryGroups,requestedGroup) ? requestedGroup : !q&&requestedGroup!=="all" ? "priority" : "" : "";
  const reachability = param(input.reachability);
  const operator = param(input.operator);
  const lifecycle = ["current","closed"].includes(param(input.lifecycle)) ? param(input.lifecycle) : "";
  const rawSort = param(input.sort);
  const sort = Object.hasOwn(catalogSorts,rawSort) ? rawSort : q ? "relevance" : "recent";
  const page = Math.min(100_000,Math.max(1,parseInt(param(input.page),10) || 1));
  const { rows,total,page:current,size,priceMatches,startingPrices } = listSites({q,category,group,status,operator,reachability,lifecycle,sort,page,includeStartingPrices:true,visibility});
  const stats=directoryStats({category,group,visibility});
  const pages = Math.max(1,Math.ceil(total/size));
  const selected = [
    q && t("关键词：{value}", { value: q }),
    !fixed && category && t("分类：{value}", { value: t(categories.find(item => item.slug === category)?.label ?? category) }),
    !fixed && requestedGroup && requestedGroup!=="all" && group && t(groupLabels[group]),
    !fixed && requestedGroup==="all" && t("全部服务"),
    Object.hasOwn(catalogStatuses,status) && t(catalogStatuses[status]),
    sort !== (q ? "relevance" : "recent") && t("排序：{value}", { value: t(catalogSorts[sort]) }),
    reachability && Object.hasOwn(reachabilityLabels,reachability) && t("检查记录：{value}", { value: t(reachabilityLabels[reachability as keyof typeof reachabilityLabels]) }),
    operator && Object.hasOwn(operators,operator) && t("运营性质：{value}", { value: t(operators[operator as keyof typeof operators]) }),
    lifecycle==="current" && t(publicLifecycleLabels.active),
    lifecycle==="closed" && t("已停运"),
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
    {fixed && <div className="crumbs"><Link href="/services">{t("服务目录")}</Link><span>/</span>{t(fixed.label)}</div>}
    <div className="catalog-heading"><h1>{t(fixed?.label ?? "服务目录")}</h1><p>{t(fixed?.description ?? "按分类、商家名称、官网域名或公开商品查找服务档案。")}</p></div>
    <p className="catalog-count">{t("公开 {count} 家 · 有公开报价 {priced} 家", { count: stats.total, priced: stats.priced })}{stats.last && " · " + t("最近更新 {date}", { date: day(stats.last) })}</p>
    {!!childCategories.length && <nav className="child-categories" aria-label={t("子分类")}>{childCategories.map((item)=><Link key={item.slug} href={categoryHref(item.slug)}>{t(item.label)}</Link>)}</nav>}
    {!fixed && <nav className="child-categories" aria-label={t("重点目录")}><Link href="/services?group=priority">{t("重点类别")}</Link>{categoryGroups["ai-retail"].some(item=>visibility.categoryAllowed(item))&&<Link href="/services?group=ai-retail">{t("AI 代充与卡网")}</Link>}{connections&&<Link href="/services?group=connections" prefetch={false}>{t("网络服务")}</Link>}<Link href="/services?group=all">{t("全部服务")}</Link></nav>}
    <form key={JSON.stringify([q,category,group,status,operator,reachability,lifecycle,sort])} className="catalog-filters" action={base}>
      {(requestedGroup||!q)&&!fixed && <input type="hidden" name="group" value={requestedGroup||""}/>}
      <label>{t("名称或关键词")}<input name="q" type="search" maxLength={160} defaultValue={q} placeholder={t("例如 OpenRouter、模型聚合")} /></label>
      {!fixed && <label>{t("分类")}<select name="category" defaultValue={category}><option value="">{t("全部分类")}</option>{categories.map((item)=><option key={item.slug} value={item.slug}>{item.parent_slug?"　":""}{t(item.label)}</option>)}</select></label>}
      <label>{t("收录内容")}<select name="status" defaultValue={status}><option value="">{t("全部档案")}</option>{Object.entries(catalogStatuses).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></label>
      <label>{t("排序")}<select name="sort" defaultValue={sort}>{Object.entries(catalogSorts).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></label>
      <button className="button primary" type="submit">{t("应用筛选")}</button>
      <details className="more-filters" open={moreOpen}>
        <summary>{t("更多筛选")}</summary>
        <div className="more-filter-grid">
          <label>{t("官网检查记录")}<select name="reachability" defaultValue={reachability}><option value="">{t("全部记录")}</option>{Object.entries(reachabilityLabels).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></label>
          <label>{t("运营性质")}<select name="operator" defaultValue={operator}><option value="">{t("全部性质")}</option>{Object.entries(operators).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></label>
          <label>{t("运营状态")}<select name="lifecycle" defaultValue={lifecycle}><option value="">{t("全部")}</option><option value="current">{t(publicLifecycleLabels.active)}</option><option value="closed">{t(publicLifecycleLabels.closed)}</option></select></label>
        </div>
      </details>
    </form>
    {!!selected.length && <p className="filter-chips">{t("已选：")}{selected.map((item)=><span key={item}>{item}</span>)} <Link href={base}>{t("清除筛选")}</Link></p>}
    <p className="catalog-count">{t("{count} 个匹配档案", { count: total })} <Link href="/policy#evidence">{t("收录说明")}</Link> · <Link href="/contact?submit=merchant">{t("提交商家")}</Link></p>
    {rows.length ? <SiteTable sites={rows} priceMatches={priceMatches} startingPrices={startingPrices} query={q}/> : <div className="plain-empty boxed-empty"><h2>{t("没有匹配的档案")}</h2><p>{t("试试简短名称、官网域名或放宽筛选。")}</p><Link className="text-link" href={base}>{t("清除筛选")}</Link></div>}
    {pages > 1 && <nav className="pagination" aria-label={t("目录分页")}>
      {current > 1 && <Link href={pageHref(current-1)}>{t("上一页")}</Link>}<span>{t("第 {page} 页", { page: `${current} / ${pages}` })}</span>{current < pages && <Link href={pageHref(current+1)}>{t("下一页")}</Link>}
    </nav>}
  </div>;
}

