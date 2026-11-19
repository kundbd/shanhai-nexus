import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Evidence,ThirdPartyReviewNote,day } from "@/components/directory/display";
import { publicEditorial } from "@/lib/directory/read";
import { observationHref } from "@/lib/directory/types";
import { contentVisibility, universalVisibility } from "@/lib/geo/request";

export const dynamic = "force-dynamic";
type Props = {params:Promise<{slug:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const visibility=await contentVisibility();
  const entry = publicEditorial((await params).slug,undefined,visibility);
  if (!entry) return {robots:{index:false,follow:false}};
  const title=visibility.filterText(entry.title);
  const description=visibility.filterText(entry.summary);
  return {title,description,alternates:{canonical:observationHref(entry.slug)},openGraph:{type:"article",title,description,url:observationHref(entry.slug),modifiedTime:entry.updated_at},
    ...(!publicEditorial(entry.slug,undefined,universalVisibility())&&{robots:{index:false,follow:false}})};
}
export default async function Observation({params}:Props) {
  const visibility=await contentVisibility();
  const entry = publicEditorial((await params).slug,undefined,visibility);
  if (!entry) notFound();
  return <article className="frame page article editorial-page">
    <div className="crumbs"><Link href="/observations">山海观察</Link></div>
    <header className="article-heading"><p className="print-label"><span />山海观察</p><h1>{visibility.filterText(entry.title)}</h1>{entry.origin==="third_party"&&<ThirdPartyReviewNote/>}<p>{visibility.filterText(entry.summary)}</p><div className="article-meta"><time dateTime={day(entry.updated_at)}>编辑于 {day(entry.updated_at)}</time></div></header>
    <div className="editorial-text">{visibility.filterText(entry.body)}</div>
    <section><h2>判断与来源</h2><Evidence editorial={entry.id}/></section>
    <Link className="text-link" href="/policy#evidence">了解内容与核实政策</Link>
  </article>;
}
