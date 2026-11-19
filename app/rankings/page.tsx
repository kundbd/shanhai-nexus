import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MerchantAvatar } from "@/components/directory/merchant-avatar";
import { OfferIcon } from "@/components/directory/offer-icon";
import { priceLabel,quoteDetailLabel } from "@/components/directory/display";
import { param,type Params } from "@/components/directory/catalog-page";
import { directory } from "@/lib/directory/db";
import { productName } from "@/lib/directory/products";
import { productRanking,shopRanking,type RankingPeriod } from "@/lib/directory/rankings";
import { pipelines,rankingCategories,type Pipeline } from "@/lib/directory/taxonomy";
import { categoryHref,siteHref } from "@/lib/directory/types";
import { contentVisibility } from "@/lib/geo/request";

export const dynamic="force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    title: t("排行榜"),
    description: t("查看各类数字服务店铺和商品的 24 小时浏览人数排行与累计浏览人数排行。"),
    alternates: { canonical: "/rankings" },
  };
}

const formatCount=new Intl.NumberFormat("zh-CN");
const rankingHref=(group:Pipeline,type:"shops"|"products",period:RankingPeriod)=>`/rankings?group=${group}&type=${type}&period=${period}`;

export default async function Rankings({searchParams}:{searchParams:Promise<Params>}) {
  const t = await getTranslations();
  const input=await searchParams;
  const visibility=await contentVisibility();
  const groups=(Object.keys(pipelines) as Pipeline[]).filter(key=>rankingCategories(key).some(category=>visibility.categoryAllowed(category)));
  const selected=param(input.group);
  if (Object.hasOwn(pipelines,selected)&&!groups.some(key=>key===selected)) notFound();
  const group=groups.find(key=>key===selected)??groups[0];
  if (!group) notFound();
  const type=param(input.type)==="products"?"products":"shops";
  const period=param(input.period)==="overall"?"overall":"24h";
  const label=type==="shops"?"店铺排行":"商品排行";
  const browse=group==="ai-retail"||group==="connections"?`/services?group=${group}`:categoryHref(group);
  const db=directory();
  const rows=type==="shops"?shopRanking(db,group,period,undefined,visibility).map(site=>({
    path:siteHref(site.slug),name:site.name,details:t(site.category_label),visitors:site.visitors,icon:<MerchantAvatar site={site}/>,
  })):productRanking(db,group,period,undefined,visibility).map(({path,visitors,site,price})=>({
    path,name:productName(price),details:[site.name,priceLabel(price),t(quoteDetailLabel(price.period))].filter(Boolean).join(" · "),
    visitors,icon:<OfferIcon price={price} site={site}/>,
  }));
  return <div className="frame page directory-page rankings-page">
    <header className="catalog-heading">
      <h1>{t("排行榜")}</h1>
      <p>{period==="overall"?t("按累计浏览人数排序。"):t("按最近 24 小时的浏览人数排序。")}{t("同一浏览器重复打开详情计一次。")}</p>
    </header>
    <div className="ranking-controls">
      <nav className="child-categories ranking-tabs" aria-label={t("排行榜类型")}>
        <Link href={rankingHref(group,"shops",period)} prefetch={false} aria-current={type==="shops"?"page":undefined}>{t("店铺排行")}</Link>
        <Link href={rankingHref(group,"products",period)} prefetch={false} aria-current={type==="products"?"page":undefined}>{t("商品排行")}</Link>
      </nav>
      <nav className="child-categories ranking-tabs" aria-label={t("排行榜时间范围")}>
        <Link href={rankingHref(group,type,"24h")} prefetch={false} aria-current={period==="24h"?"page":undefined}>{t("24 小时")}</Link>
        <Link href={rankingHref(group,type,"overall")} prefetch={false} aria-current={period==="overall"?"page":undefined}>{t("综合")}</Link>
      </nav>
    </div>
    <nav className="child-categories ranking-categories" aria-label={t("排行榜分类")}>
      {groups.map(key=><Link key={key} href={rankingHref(key,type,period)} prefetch={false} aria-current={group===key?"page":undefined}>{t(pipelines[key].label)}</Link>)}
    </nav>
    <section aria-labelledby="ranking-heading">
      <div className="ranking-heading"><h2 id="ranking-heading">{t(pipelines[group].label)} · {t(label)}</h2>{rows.length>0&&<span>{t("浏览人数")}</span>}</div>
      {rows.length?<ol className="ranking-list">{rows.map(({path,name,details,visitors,icon})=>{
        const rank=rows.findIndex(row=>row.visitors===visitors)+1;
        return <li key={path} value={rank}>
          <span className="ranking-position" aria-hidden="true">{rank}</span>
          <div className="ranking-entry">
            {icon}<div><Link href={path} prefetch={false}>{name}</Link><p>{details}</p></div>
          </div>
          <span className="ranking-visitors">{t("{count} 人", { count: formatCount.format(visitors) })}</span>
        </li>;
      })}</ol>:<p className="plain-empty ranking-empty">{period === "24h"
        ? t(type === "shops" ? "近 24 小时暂无该分类的店铺浏览记录。" : "近 24 小时暂无该分类的商品浏览记录。")
        : t(type === "shops" ? "暂无该分类的店铺浏览记录。" : "暂无该分类的商品浏览记录。")}<Link className="text-link" href={browse}>{t("浏览该分类")}</Link></p>}
    </section>
  </div>;
}
