import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { PublicSearch } from "@/components/directory/search-form";
import { HomePrices } from "@/components/directory/home-prices";
import type { Params } from "@/components/directory/catalog-page";
import { CatalogBadge, day } from "@/components/directory/display";
import { MerchantAvatar } from "@/components/directory/merchant-avatar";
import { priorityCategoryTabs } from "@/components/directory/priority-category-tabs";
import { countPublicAiRetailProducts, countPublicSites, listSites } from "@/lib/directory/read";
import { categoryHref, siteHref } from "@/lib/directory/types";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";
const countFormat=new Intl.NumberFormat("zh-CN");
const quickSearches = ["ChatGPT 会员", "DeepSeek API 中转", "机场订阅", "虚拟信用卡", "轻量云"];
export const metadata: Metadata = {
  alternates: { canonical:"/" },
  openGraph: { title:`${brand.name} · 独立数字服务评测与消费指南`, description:brand.motto, url:"/" },
};

export default async function Home({searchParams}:{searchParams:Promise<Params>}) {
  const input=await searchParams;
  const recent = listSites({size:6,lifecycle:"current",sort:"recent"}).rows;
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
        <nav className="home-paths" aria-label="主要阅读路径">
          <Link href="/services"><strong>查阅目录</strong><span>按分类查看公开档案</span></Link>
          <Link href="/observations"><strong>阅读观察</strong><span>查看有来源的编辑整理</span></Link>
        </nav>
      </div>
      <nav id="home-categories" className="category-strip" aria-label="重点服务分类">{priorityCategoryTabs.map(({item:c,Icon})=><Link key={c.label} href={"group" in c?`/services?group=${c.group}`:categoryHref(c.category)}>
        <div>
          <h2><Icon size={16} aria-hidden="true"/>{c.label}</h2><p>{c.description}</p>
          <p className="category-count">
            公开档案 {countPublicSites({...("group" in c?{group:c.group}:{category:c.category}),lifecycle:"current"})} 家
            {"group" in c&&c.group==="ai-retail"&&<><br/>公开商品 {countFormat.format(countPublicAiRetailProducts())} 件</>}
          </p>
        </div><ArrowUpRight size={19} aria-hidden="true" />
      </Link>)}</nav>
    </section>

    <section className="home-announcement" aria-labelledby="site-announcement">
      <h2 id="site-announcement">站点公告</h2>
      <div>
        <p><strong>当前可用</strong>可查商家档案、商品报价和山海观察。登录后可匿名评价商家，也可以用账号名在社区发帖和互动。</p>
        <p><strong>后续维护</strong>持续补充商家和商品，定期复核报价和失效链接，审核社区内容并处理纠错。<Link className="text-link" href="/contact">提交纠错</Link></p>
        <p className="home-announcement-rule">评论区严禁涉政</p>
      </div>
    </section>

    <HomePrices input={input}/>

    {!!recent.length && <section aria-labelledby="recent">
      <div className="directory-section"><h2 id="recent">最近更新</h2><Link href="/services">服务目录 <ArrowRight size={15} aria-hidden="true" /></Link></div>
      <ul className="recent-list">{recent.map((site)=><li key={site.id}><div className="recent-merchant"><MerchantAvatar site={site} size={32}/><div><Link href={siteHref(site.slug)}>{site.name}</Link><span className="record-domain">{site.domain}</span></div></div><CatalogBadge site={site}/><time dateTime={site.updated_at}>{day(site.updated_at)}</time></li>)}</ul>
    </section>}

  </div>;
}
