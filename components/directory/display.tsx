import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { categoryHref, editorialOrigins, incidentLabels, natures, observationHref, siteHref, type Editorial, type Incident, type Price, type Site, type Source } from "@/lib/directory/types";
import { publicClaims,type SitePriceMatch } from "@/lib/directory/read";
import { Highlight } from "@/components/catalog/highlight";
import { directory } from "@/lib/directory/db";
import { reviewSummaries,type ReviewSummary } from "@/lib/directory/reviews";
import { operators,publicLifecycleLabels,publicWebsiteLabel } from "@/lib/directory/taxonomy";
import { MerchantAvatar } from "./merchant-avatar";

export function CatalogBadge({site}:{site:Site}) {
  const label=site.product_observed_at?"公开商品已收录":site.has_public_prices?"有公开报价":"已收录";
  return <span className="category-tag">{label}</span>;
}

export function quoteDetailLabel(value: string | null | undefined) {
  const label=value?.trim()??"";
  return /^(?:官网|(?:报价)?地区|周期|计价单位)?未注明$/.test(label)?"":label;
}

const localDate = new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
export function day(value?: string | null) {
  if (!value) return "尚未核实";
  const parsed=value.includes("T")?new Date(value):null;
  return parsed&&Number.isFinite(+parsed)?localDate.format(parsed):value.slice(0,10);
}

export function priceLabel(price: Price) {
  try {
    const scale=price.amount_scale;
    const formatter = new Intl.NumberFormat("zh-CN",{style:"currency",currency:price.currency,currencyDisplay:"code",...(scale!=null&&{maximumFractionDigits:scale,minimumFractionDigits:Math.min(2,scale)})});
    return formatter.format(price.amount_minor / 10 ** (scale??formatter.resolvedOptions().maximumFractionDigits??2));
  } catch {
    return `${price.amount_minor} ${price.currency}（最小单位）`;
  }
}

export function External({ href, children }: { href: string; children: React.ReactNode }) {
  return <a className="external-ref" href={href} rel="noreferrer" target="_blank">{children}<ArrowUpRight size={13} aria-hidden="true" /></a>;
}

export function ShopRatingBadge({href,summary}:{href:string;summary?:ReviewSummary}) {
  const {average,ratings}=summary??{average:null,ratings:0};
  const scored=average!==null;
  return <Link className={`category-tag shop-rating${scored?" shop-rating-scored":""}`} href={href}>
    {scored?`综合评分 ${average.toFixed(1)} / 5 · ${ratings} 个评分`:"评分暂无"}
  </Link>;
}

export function SiteTable({ sites,priceMatches,query="" }: { sites: readonly Site[];priceMatches?:ReadonlyMap<number,SitePriceMatch>;query?:string }) {
  const ratings=reviewSummaries(directory(),sites.map(({id})=>id));
  return <div className="records" role="table" aria-label="服务商档案">
    <div className="record record-head" role="row"><span role="columnheader">服务商</span><span role="columnheader">分类</span><span role="columnheader">收录内容</span><span role="columnheader">最近更新</span><span role="columnheader" aria-label="查看档案" /></div>
    {sites.map((site) => {
      const match=priceMatches?.get(site.id);
      return <div className="record" key={site.id} role="row">
      <div className="record-name" role="cell"><MerchantAvatar site={site}/><div><Link href={siteHref(site.slug)}>{site.name}</Link><span className="record-domain">{site.hosted_storefront?site.domain+new URL(site.website).pathname:site.domain}</span>{site.summary && <p>{site.summary}</p>}
        {match&&<p className="record-price-match">{match.storefront?"匹配商品":"匹配报价"} · <Link href={`${siteHref(site.slug)}#prices`}><Highlight value={match.label} query={query}/></Link></p>}
      </div></div>
      <div className="record-category" role="cell"><Link className="category-tag" href={categoryHref(site.category_slug)}>{site.category_label}</Link><ShopRatingBadge href={`${siteHref(site.slug)}#reviews`} summary={ratings.get(site.id)}/></div>
      <div role="cell"><CatalogBadge site={site}/><small className="record-date block">{publicLifecycleLabels[site.lifecycle]}</small></div>
      <div role="cell" className="record-date">{day(site.updated_at)}<small className="block">{publicWebsiteLabel}</small>{site.operator_kind!=="unknown" && <small className="block">{operators[site.operator_kind]}</small>}</div>
      <div role="cell" className="record-open"><Link href={siteHref(site.slug)} aria-label={`查看 ${site.name} 档案`}><ArrowRight size={17} aria-hidden="true" /></Link></div>
    </div>})}
  </div>;
}

export function EventList({ events, compact = false }: { events: readonly Incident[]; compact?: boolean }) {
  if (!events.length) return <p className="plain-empty">暂无公开事件记录。</p>;
  return <ul className={`event-list${compact ? " event-compact" : ""}`}>{events.map((event) => <li key={event.id}>
    <time dateTime={event.occurred_at}>{day(event.occurred_at)}</time>
    <div><span className="category-tag">{incidentLabels[event.kind]}</span><h3>{event.title}</h3><p>{event.summary}</p>
      <div className="event-actions"><Link href={`${siteHref(event.site_slug)}#incidents`}>{event.site_name}</Link><External href={event.source_url}>原始记录</External></div>
    </div>
  </li>)}</ul>;
}

export function Evidence({ editorial }: { editorial: number }) {
  const claims = publicClaims(editorial);
  return <ul className="claims">{claims.map((claim) => <li key={claim.id}><span className="category-tag">{natures[claim.nature]}</span>
    <strong>{claim.label}</strong><p>{claim.statement}</p>{claim.url && <External href={claim.url}>{claim.source_title ?? "查看来源"}</External>}
  </li>)}</ul>;
}

export function SourcesList({ sources }: { sources: readonly Source[] }) {
  if (!sources.length) return <p className="plain-empty">暂无公开资料来源。</p>;
  return <ul className="source-list">{sources.map((source) => <li key={source.id}>
    <External href={source.url}>{source.kind==="official" || source.verified ? source.title : source.attribution || "发现来源"}</External><span>{day(source.accessed_at)} · {source.verified ? natures[source.kind] : source.kind==="official" ? "商家公开资料" : "发现来源"}</span>
    {source.license_url && <External href={source.license_url}>数据许可</External>}
    {!!source.verified && source.excerpt && <p>{source.excerpt}</p>}
  </li>)}</ul>;
}

export function ThirdPartyReviewNote() {
  return <p className="third-party-note"><span className="category-tag">{editorialOrigins.third_party}</span> 内容观点仅代表原作者，不代表山海知序立场。</p>;
}

export function ObservationLink({ entry }: { entry: Editorial }) {
  const { slug,title,summary,updated_at,origin }=entry;
  return <article className="observation-row"><time dateTime={day(updated_at)}>{day(updated_at)} · {editorialOrigins[origin]}</time><h3><Link href={observationHref(slug)}>{title}</Link></h3><p>{summary}</p></article>;
}
