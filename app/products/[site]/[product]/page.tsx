import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { External,day,priceLabel,quoteDetailLabel } from "@/components/directory/display";
import { OfferIcon } from "@/components/directory/offer-icon";
import { directory } from "@/lib/directory/db";
import { getPublicProduct,productHref,productName } from "@/lib/directory/products";
import { getSiteById } from "@/lib/directory/read";
import { siteHref } from "@/lib/directory/types";
import { trafficProduct } from "@/lib/traffic-path";
import { contentVisibility } from "@/lib/geo/request";

export const dynamic="force-dynamic";
type Props={params:Promise<{site:string;product:string}>};
const details=cache(async (site:string,product:string)=>{
  const ref=trafficProduct(`/products/${site}/${product}`);
  if (!ref) return;
  const db=directory();
  const merchant=getSiteById(ref.siteId,db,await contentVisibility());
  const price=merchant&&getPublicProduct(db,ref.siteId,ref.key);
  if (price&&merchant) return {price,merchant};
});

export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {site,product}=await params;
  const result=await details(site,product);
  if (!result) return {robots:{index:false,follow:false}};
  return {
    title:`${productName(result.price)} · ${result.merchant.name}`,
    alternates:{canonical:productHref(result.price)},
    robots:{index:false,follow:true},
  };
}

export default async function Product({params}:Props) {
  const {site,product}=await params;
  const result=await details(site,product);
  if (!result) notFound();
  const {price,merchant}=result;
  const visibility=await contentVisibility();
  const period=quoteDetailLabel(price.period);
  const region=quoteDetailLabel(price.region);
  return <div className="frame page directory-page product-page">
    <div className="crumbs"><Link href="/services">服务目录</Link><span>/</span><Link href={siteHref(merchant.slug)}>{merchant.name}</Link></div>
    <header className="catalog-heading">
      <div className="product-heading"><OfferIcon price={price} site={merchant}/><h1>{productName(price)}</h1></div>
      <p>{merchant.category_label}</p>
    </header>
    <dl className="fact-grid">
      <div><dt>公开标价</dt><dd><strong>{priceLabel(price)}</strong></dd></div>
      {period&&<div><dt>计费周期</dt><dd>{period}</dd></div>}
      {region&&<div><dt>计价地区</dt><dd>{region}</dd></div>}
      <div><dt>报价记录</dt><dd>{day(price.recorded_at)}</dd></div>
    </dl>
    {price.notes&&<p className="section-note">{visibility.filterText(price.notes)}</p>}
    <div className="product-sources">
      <External href={price.source_url}>{price.reported_item_url?"第三方报价快照":"报价来源"}</External>
      {price.reported_item_url&&<External href={price.reported_item_url}>原商品页</External>}
      <Link className="text-link" href={`${siteHref(merchant.slug)}#prices`}>查看店铺其他商品</Link>
    </div>
  </div>;
}
