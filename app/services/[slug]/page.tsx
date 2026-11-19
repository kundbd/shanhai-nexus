import { getSiteLanguage, getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound,permanentRedirect } from "next/navigation";
import { CatalogBadge,Evidence,EventList,External,ShopRatingBadge,SourcesList,ThirdPartyReviewNote,day,priceLabel,quoteDetailLabel } from "@/components/directory/display";
import { getDomains,getSite,getStorefronts,latestPrices,merchantTags,publicEditorials,publicIncidents,publicPrices,publicSources } from "@/lib/directory/read";
import { ShopReviews } from "@/components/directory/shop-reviews";
import { MerchantAvatar } from "@/components/directory/merchant-avatar";
import { OfferIcon } from "@/components/directory/offer-icon";
import { param,type Params } from "@/components/directory/catalog-page";
import { categoryHref,noData,observationHref,siteHref,type Site } from "@/lib/directory/types";
import { publicLifecycleLabels,operators,publicWebsiteLabel,merchantFields,deliveryLabels } from "@/lib/directory/taxonomy";
import { directory,one } from "@/lib/directory/db";
import { reviewSummary } from "@/lib/directory/reviews";
import { storefrontTierNeedsReview } from "@/lib/directory/price-board";
import { productHref,productName } from "@/lib/directory/products";
import { contentVisibility, universalVisibility } from "@/lib/geo/request";

export const dynamic = "force-dynamic";
type Props = {params:Promise<{slug:string}>;searchParams:Promise<Params>};
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const visibility=await contentVisibility();
  const site = getSite((await params).slug,undefined,visibility);
  if (!site) return {robots:{index:false,follow:false}};
  const t = await getTranslations();
  const description = site.summary ? visibility.filterText(site.summary) : t("{name}的公开目录记录。分类为{category}。", { name: site.name, category: t(site.category_label) });
  return {title:t("{name} 服务档案", { name: site.name }),description,alternates:{canonical:siteHref(site.slug)},openGraph:{type:"website",title:`${site.name} · ${t("山海知序")}`,description,url:siteHref(site.slug)},
    ...(!getSite(site.slug,undefined,universalVisibility())&&{robots:{index:false,follow:false}})};
}

export default async function Profile({params,searchParams}:Props) {
  const t = await getTranslations();
  const {slug}=await params;
  const visibility=await contentVisibility();
  const site = getSite(slug,undefined,visibility);
  if (!site) {
    const redirect=one<{slug:string}>(directory(),"SELECT s.slug FROM site_redirects r JOIN sites s ON s.id=r.site_id AND s.publication='published' WHERE r.old_slug=?",slug);
    if (redirect&&getSite(redirect.slug,undefined,visibility)) permanentRedirect(siteHref(redirect.slug));
    notFound();
  }
  const details = JSON.parse(site.merchant_details) as Record<string,string>;
  const showDetails=site.status!=="listed";
  const productAdmission=site.product_observed_at;
  const reachableOn=site.reachability==="reachable"?site.checked_at:null;
  const prices = publicPrices(site.id);
  const current = latestPrices(prices);
  const productCount=current.filter(price=>price.storefront_observed).length;
  const currentIds = new Set(current.map(({id})=>id));
  const history = prices.filter((record)=>!currentIds.has(record.id));
  const reviewParams=await searchParams;
  const reviewPage=Math.max(1,Number.parseInt(param(reviewParams.reviewPage),10)||1);
  const ratings=reviewSummary(directory(),site.id);
  const events = publicIncidents(site.id,undefined,undefined,visibility);
  const editorials = publicEditorials(site.id,undefined,undefined,visibility);
  const seenSnapshots=new Set<string>();
  const sources = publicSources(site.id).filter(source=>{
    if(source.attribution!=="AI Price Memory（PriceMemo）") return true;
    if(seenSnapshots.has(source.url)) return false;
    seenSnapshots.add(source.url);
    return true;
  });
  const domains = getDomains(site.id).filter(({kind})=>kind !== "primary");
  const storefronts = getStorefronts(site.id).filter(({url})=>visibility.linkAllowed(url));
  const tags=merchantTags(site.id);
  const tagSeparator = (await getSiteLanguage()) === "en" ? ", " : "、";
  const sections = { basics:"基本信息",prices:productCount?"商品与标价":"价格记录",observation:"山海观察",offers:"产品及服务",incidents:"事件记录",reviews:"用户评价",sources:"来源与说明" };
  return <div className="frame page directory-page">
    <div className="crumbs"><Link href="/services">{t("服务目录")}</Link><span>/</span><Link href={categoryHref(site.category_slug)}>{t(site.category_label)}</Link></div>
    <header className="profile-header">
      <div>
        <div className="profile-status">
          <CatalogBadge site={site}/>
          {site.lifecycle==="closed" && <span className="category-tag">{t(publicLifecycleLabels.closed)}</span>}
          <Link className="category-tag" href={categoryHref(site.category_slug)}>{t(site.category_label)}</Link>
          <ShopRatingBadge href="#reviews" summary={ratings}/>
        </div>
        <div className="profile-merchant-name"><MerchantAvatar site={site} size={56}/><h1>{site.name}</h1></div>
        {site.summary&&<p>{visibility.filterText(site.summary)}</p>}
      </div>
      {visibility.linkAllowed(site.website)&&<div className="profile-actions">
        <a className="button" href={site.website} rel="noreferrer" target="_blank">{site.hosted_storefront?t("访问店铺"):t("访问官网")}</a>
      </div>}
    </header>
    <div className="profile-layout">
      <aside><nav className="profile-nav" aria-label={t("档案章节")}>{Object.entries(sections).map(([key,label])=><a key={key} href={`#${key}`}>{t(label)}</a>)}</nav></aside>
      <div className="profile-content">
        <section id="basics"><h2>{t("基本信息")}</h2><dl className="fact-grid">
          <div><dt>{t("分类")}</dt><dd>{t(site.category_label)}</dd></div><div><dt>{t("公开联系方式")}</dt><dd>{(showDetails&&site.contact&&visibility.filterText(site.contact))||t(noData)}</dd></div>
          <div><dt>{t("收录日期")}</dt><dd>{day(site.added_at)}</dd></div>
          {productAdmission&&<div><dt>{t("报价观察日期")}</dt><dd>{day(productAdmission)}</dd></div>}
          <div><dt>{t("运营性质")}</dt><dd>{t(operators[site.operator_kind])}</dd></div>
          <div><dt>{t("官网可达性")}</dt><dd>{t(publicWebsiteLabel)}{reachableOn?` · ${day(reachableOn)}`:""}</dd></div>
          {site.website_language&&<div><dt>{t("官网语言")}</dt><dd>{t(site.website_language)}</dd></div>}
          {!!tags.length&&<div><dt>{t("服务标签")}</dt><dd>{tags.join(tagSeparator)}</dd></div>}
          {domains.map(({domain,kind})=><div key={domain}><dt>{kind==="historical"?t("历史域名"):t("别名域名")}</dt><dd>{domain}</dd></div>)}
          <div><dt>{site.hosted_storefront?t("平台店铺"):t("官网域名")}</dt><dd><External href={site.website}>{site.hosted_storefront?site.domain+new URL(site.website).pathname:site.domain}</External></dd></div>
          {storefronts.filter(({url})=>url!==site.website).map(({url,host})=><div key={url}><dt>{t("关联店铺")}</dt><dd><External href={url}>{host+new URL(url).pathname}</External></dd></div>)}
        </dl>{reachableOn&&<p className="section-note">{t("可达性日期对应公开网页检查记录。节点速度、接口质量和服务稳定性需另行实测。")}</p>}</section>
        <section id="prices"><h2>{t(sections.prices)}</h2>
          {current.length ? <><p className="section-note">{productCount?t("已收录 {count} 项商品标价。实际金额、库存和交付条件以原商品页及结算页为准。", { count: productCount }):t("公开报价按所示日期记录。实际金额以商家对应地区、服务周期和结算页为准。")}</p><CurrentPrices rows={current} site={site} collapse={productCount>6} linkProducts={site.lifecycle!=="closed"}/></> : <p className="plain-empty">{t("暂无公开报价。")}</p>}
          {!!history.length && <details className="historical"><summary>{t("历史价格记录")}</summary><PriceList rows={history} site={site}/></details>}
        </section>
        <section id="observation"><h2>{t("山海观察")}</h2>{editorials.length ? editorials.map((entry)=><article className="inline-observation" key={entry.id}><h3><Link href={observationHref(entry.slug)} prefetch={false}>{visibility.filterText(entry.title)}</Link></h3>{entry.origin==="third_party"&&<ThirdPartyReviewNote/>}<p>{visibility.filterText(entry.summary)}</p><div className="editorial-text">{visibility.filterText(entry.body)}</div><Evidence editorial={entry.id}/><small>{t("编辑日期 ·")}{" "}{day(entry.updated_at)}</small></article>) : <p className="plain-empty">{t("暂无编辑观察。")}</p>}</section>
        <section id="offers"><h2>{t("产品及服务")}</h2>{productAdmission?<p>{t("可在")}<a href="#prices">{t("商品与标价")}</a>{t("查看已收录的公开商品及来源。")}</p>:!showDetails?<p className="plain-empty">{t("套餐、付款与售后暂无可靠数据。")}</p>:<dl className="fact-grid">{[
          ["主要产品",site.products],["付款方式",site.payments],["手续费",site.fees],["续费与计费",site.renewal],["退款与售后",site.refunds],["地区与限制",site.regions],
          ...Object.entries(merchantFields).filter(([key])=>Object.hasOwn(details,key)).map(([key,label])=>[label,key==="delivery_methods" ? details[key].split(",").map((method)=>t(deliveryLabels[method as keyof typeof deliveryLabels] ?? method)).join(tagSeparator):details[key]] as const),
        ].map(([label,value])=><div key={label}><dt>{t(label ?? "")}</dt><dd>{value ? visibility.filterText(value) : t(noData)}</dd></div>)}</dl>}</section>
        <section id="incidents"><h2>{t("事件记录")}</h2><EventList events={events}/></section>
        <ShopReviews site={site} page={reviewPage} status={param(reviewParams.review)} summary={ratings}/>
        <section id="sources"><h2>{t("来源与免责声明")}</h2><SourcesList sources={sources}/>
          <p className="section-note">{t("公开资料可能变化，地区与账号条件可能不同。商家测评可查看「山海观察」。")}</p>
          <Link className="text-link" href={`/contact?site=${site.slug}`}>{t("提交纠错或商家回应")}</Link>
        </section>
      </div>
    </div>
  </div>;
}

type PriceListProps = {rows:ReturnType<typeof publicPrices>;site:Pick<Site,"category_slug"|"slug">;linkProducts?:boolean};

async function CurrentPrices({rows,site,collapse,linkProducts}:PriceListProps&{collapse:boolean}) {
  const t = await getTranslations();
  if (!collapse) return <PriceList rows={rows} site={site} linkProducts={linkProducts}/>;
  const previewSize=6;
  return <>
    <PriceList rows={rows.slice(0,previewSize)} site={site} linkProducts={linkProducts}/>
    <details className="product-overflow">
      <summary><span className="product-expand">{t("展开其余 {count} 项", { count: rows.length - previewSize })}</span><span className="product-collapse">{t("收起其余商品")}</span></summary>
      <PriceList rows={rows.slice(previewSize)} site={site} linkProducts={linkProducts}/>
    </details>
  </>;
}

async function PriceList({rows,site,linkProducts}:PriceListProps) {
  const t = await getTranslations();
  const visibility=await contentVisibility();
  return <ul className="price-list">{rows.map((price)=>{
    const period=t(quoteDetailLabel(price.period));
    const context=[t(quoteDetailLabel(price.region)),day(price.recorded_at)].filter(Boolean).join(" · ");
    return <li key={price.id}>
      <div className="profile-price-details">
        <div className="profile-price-name"><OfferIcon price={price} site={site}/><strong>
          {linkProducts?<Link href={productHref(price)} prefetch={false}>{productName(price)}</Link>:productName(price)}
        </strong></div>
        {price.product_title&&price.product_title!==price.plan&&<span>{storefrontTierNeedsReview(price)?t("套餐归类待核对"):price.plan}</span>}
        <span>{context}</span>
        {price.notes && <p>{visibility.filterText(price.notes)}</p>}
      </div>
      <div className="profile-price-quote">
        <div className="profile-price-amount"><strong>{priceLabel(price)}</strong>{period&&<span>{period}</span>}</div>
        <div className="profile-price-links">
          <External href={price.source_url}>{price.reported_item_url?t("第三方报价快照"):t("报价来源")}</External>
          {price.reported_item_url&&<External href={price.reported_item_url}>{t("原商品页")}</External>}
        </div>
      </div>
    </li>;
  })}</ul>;
}
