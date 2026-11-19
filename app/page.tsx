import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { HomeAdCarousel } from "@/components/directory/home-ad-carousel";
import { PublicSearch } from "@/components/directory/search-form";
import { HomePrices } from "@/components/directory/home-prices";
import type { Params } from "@/components/directory/catalog-page";
import { CatalogBadge, StartingPriceLabel, day } from "@/components/directory/display";
import { MerchantAvatar } from "@/components/directory/merchant-avatar";
import { visiblePriorityCategoryTabs } from "@/components/directory/priority-category-tabs";
import { countPublicAiRetailProducts, countPublicSites, listPublicCategories, listSites } from "@/lib/directory/read";
import { isRetiredCategory } from "@/lib/directory/taxonomy";
import { categoryHref, siteHref } from "@/lib/directory/types";
import { brand } from "@/lib/brand";
import { visibleHomeAds } from "@/lib/geo/catalog";
import { contentVisibility } from "@/lib/geo/request";
import { categoryIcons } from "@/components/directory/category-icon";

export const dynamic = "force-dynamic";
const countFormat=new Intl.NumberFormat("zh-CN");
const quickSearches = ["ChatGPT 会员", "DeepSeek API 中转", "虚拟信用卡", "轻量云"];
export const metadata: Metadata = {
  alternates: { canonical:"/" },
  openGraph: { title:`${brand.name} · 独立数字服务评测与消费指南`, description:brand.motto, url:"/" },
};

export default async function Home({searchParams}:{searchParams:Promise<Params>}) {
  const input=await searchParams;
  const visibility=await contentVisibility();
  const ads=visibleHomeAds(visibility);
  const {rows:recent,startingPrices}=listSites({size:6,lifecycle:"current",sort:"recent",includeStartingPrices:true,visibility});
  const networkCategories=listPublicCategories(undefined,visibility).filter(category=>isRetiredCategory(category.slug));
  return <div className="frame directory-home">
    <section className="intro" aria-labelledby="home-title">
      <div className="intro-content">
        <p className="print-label">独立数字服务评测与消费指南 · {brand.english}</p>
        <h1 id="home-title">{brand.motto}</h1>
        <p className="intro-caption">整理公开价格、使用条件和有来源的事件，供你在订阅或购买前核对。</p>
        <p className="status-legend">目录收录可访问的商家公开页面。公开商品与报价附来源。</p>
        <PublicSearch />
        <div className="quick-search">
          <span>试试搜索</span>
          {quickSearches.map((query) => (
            <Link key={query} href={{ pathname: "/search", query: { q: query } }} prefetch={false}>
              {query}
            </Link>
          ))}
        </div>
        {ads.length>0 && <HomeAdCarousel key={ads.map(ad=>ad.id).join(",")} ads={ads}/>}
      </div>
      <nav id="home-categories" className="category-strip" aria-label="重点服务分类">{visiblePriorityCategoryTabs(visibility).map(({item:c,Icon})=><Link key={c.label} href={"group" in c?`/services?group=${c.group}`:categoryHref(c.category)} prefetch={false}>
        <div>
          <h2><Icon size={16} aria-hidden="true"/>{c.label}</h2><p>{c.description}</p>
          <p className="category-count">
            公开档案 {countPublicSites({...("group" in c?{group:c.group}:{category:c.category}),lifecycle:"current",visibility})} 家
            {"group" in c&&c.group==="ai-retail"&&<><br/>公开商品 {countFormat.format(countPublicAiRetailProducts(undefined,visibility))} 件</>}
          </p>
        </div><ArrowUpRight size={19} aria-hidden="true" />
      </Link>)}{networkCategories.map(category=>{
        const Icon=categoryIcons[category.slug as keyof typeof categoryIcons];
        return <Link key={category.slug} href={categoryHref(category.slug)} prefetch={false}>
          <div><h2>{Icon&&<Icon size={16} aria-hidden="true"/>}{category.label}</h2><p>{category.description}</p></div>
          <ArrowUpRight size={19} aria-hidden="true"/>
        </Link>;
      })}</nav>
    </section>

    <HomePrices input={input} visibility={visibility}/>

    {!!recent.length && <section aria-labelledby="recent">
      <div className="directory-section"><h2 id="recent">最近更新</h2></div>
      <ul className="recent-list">
        {recent.map(site=><li key={site.id}>
          <div className="recent-merchant">
            <MerchantAvatar site={site} size={32}/>
            <div><Link href={siteHref(site.slug)}>{site.name}</Link><span className="record-domain">{site.domain}</span></div>
          </div>
          <div className="record-start-price recent-start-price"><StartingPriceLabel price={startingPrices?.get(site.id)}/></div>
          <CatalogBadge site={site}/>
          <time dateTime={site.updated_at}>{day(site.updated_at)}</time>
        </li>)}
      </ul>
    </section>}

  </div>;
}
