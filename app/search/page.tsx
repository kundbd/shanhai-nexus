import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { IconTile } from "@/components/catalog/icon";
import { PublicSearch } from "@/components/directory/search-form";
import { SiteTable } from "@/components/directory/display";
import { listSites,publicEditorials,publicClaims } from "@/lib/directory/read";
import { directorySearch } from "@/lib/directory/search-query";
import { observationHref } from "@/lib/directory/types";
import { resultLabels, type ResultKind } from "@/lib/search";
import { MAX_QUERY_LENGTH } from "@/lib/search/query";
import { resultKinds, searchService } from "@/lib/search/provider";
import { Highlight } from "@/components/catalog/highlight";
import { catalogLinkAllowed } from "@/lib/geo/catalog";
import { contentVisibility } from "@/lib/geo/request";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "搜索", description: "搜索山海知序的服务商、观察及工具。", robots: { index: false, follow: false } };
const labels = { service:"服务商", observation:"山海观察", ...resultLabels };
type Kind = ResultKind | "service" | "observation";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; type?: string | string[];page?:string|string[] }> }) {
  const { q, type,page } = await searchParams;
  const query = (typeof q === "string" ? q : q?.[0] ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const kinds: Kind[] = ["service","observation",...resultKinds];
  const active = kinds.find((kind) => kind === type);
  const visibility=await contentVisibility();
  const all = await searchService.search(query, undefined, result=>catalogLinkAllowed(visibility,result.href));
  const results = active ? all.filter((item) => item.kind === active) : all;
  const servicePage=typeof page==="string"&&/^\d{1,6}$/.test(page)?Number(page):1;
  const sites = query ? listSites({q:query,size:active==="service"?20:12,page:active==="service"?servicePage:1,visibility}) : {rows:[],total:0,page:1,size:12,priceMatches:undefined};
  const sitePages=Math.max(1,Math.ceil(sites.total/sites.size));
  const observationSearch=directorySearch(query,false);
  const observations = query ? publicEditorials(undefined,-1,undefined,visibility).map((entry)=>({entry,score:observationSearch.score([
    {text:visibility.filterText(entry.title),weight:12},{text:visibility.filterText(entry.summary),weight:8},{text:visibility.filterText(entry.body),weight:5},
    ...publicClaims(entry.id).filter((claim)=>claim.nature!=="pending").map(({statement})=>({text:visibility.filterText(statement),weight:5})),
  ])})).filter(({score})=>score>0).sort((a,b)=>b.score-a.score) : [];
  const count = (kind:Kind) => kind==="service" ? sites.total : kind==="observation" ? observations.length : all.filter((item)=>item.kind===kind).length;
  const allTotal = sites.total+observations.length+all.length;
  const total = active ? count(active) : allTotal;
  const showSites = !active || active==="service";
  const showObservations = !active || active==="observation";

  function href(kind?: Kind, targetPage=1) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (kind) params.set("type", kind);
    if (kind==="service"&&targetPage>1) params.set("page",String(targetPage));
    return params.size ? `/search?${params}` : "/search";
  }

  return <div className="frame page narrow directory-page">
    <div className="catalog-heading"><p className="print-label">检索</p><h1>搜索山海知序</h1></div>
    <PublicSearch q={query} />
    <nav className="filter-pills" aria-label="按结果类型筛选">
      <Link href={href()} prefetch={false} aria-current={!active ? "page" : undefined}>全部 <span>{allTotal}</span></Link>
      {kinds.map((kind) => <Link key={kind} href={href(kind)} prefetch={false} aria-current={active === kind ? "page" : undefined}>{labels[kind]} <span>{count(kind)}</span></Link>)}
    </nav>
    {query && <p className="results-count">找到 {total} 条结果</p>}
    {showSites && !!sites.rows.length && <section className="search-group"><h2>服务商</h2><SiteTable sites={sites.rows} priceMatches={sites.priceMatches} query={query}/>
      {sitePages>1 && (active==="service"?<nav className="pagination" aria-label="服务商搜索分页">
        {sites.page>1&&<Link href={href("service",sites.page-1)} prefetch={false}>上一页</Link>}
        <span>第 {sites.page} / {sitePages} 页</span>
        {sites.page<sitePages&&<Link href={href("service",sites.page+1)} prefetch={false}>下一页</Link>}
      </nav>:<Link className="text-link" href={href("service")} prefetch={false}>查看全部 {sites.total} 家匹配服务商</Link>)}
    </section>}
    {showObservations && !!observations.length && <section className="search-group"><h2>山海观察</h2><div className="surface result-list">
      {observations.map(({entry})=><Link key={entry.id} className="result-card" href={observationHref(entry.slug)} prefetch={false}><div><h2><Highlight value={visibility.filterText(entry.title)} query={query}/></h2><p><Highlight value={visibility.filterText(entry.summary)} query={query}/></p></div><ArrowRight size={17} aria-hidden="true"/></Link>)}
    </div></section>}
    {results.length ? <div className="surface result-list">
      {results.map((item) => <Link className="result-card" key={item.id} href={item.href} prefetch={false}>
        <IconTile icon={item.kind === "tool" ? "tool" : item.kind === "diagnosis" ? "terminal" : "book"} tone={item.kind === "guide" ? "indigo" : "teal"} />
        <div><span className="result-kind">{resultLabels[item.kind]} · {item.category}</span><h2><Highlight value={visibility.filterText(item.title)} query={query} /></h2><p><Highlight value={visibility.filterText(item.excerpt ?? item.description)} query={query} /></p></div>
        <ArrowRight size={18} className="card-arrow" aria-hidden="true" />
      </Link>)}
    </div> : null}
    {!total && <div className="empty surface"><Search size={25} aria-hidden="true" /><h2>{query ? "没有找到匹配的内容" : "输入名称、域名或关键词"}</h2><p>{query ? "试试店名、域名、具体型号，或减少搜索条件。" : "可查找服务商、商品、山海观察及站内工具。"}</p>{query && active && <Link className="text-link" href={href()} prefetch={false}>查看全部类型 <ArrowRight size={16} /></Link>}</div>}
  </div>;
}
