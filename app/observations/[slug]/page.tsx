import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Evidence,ThirdPartyReviewNote,day } from "@/components/directory/display";
import { publicEditorial } from "@/lib/directory/read";
import { observationHref } from "@/lib/directory/types";

export const dynamic = "force-dynamic";
type Props = {params:Promise<{slug:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const entry = publicEditorial((await params).slug);
  return entry ? {title:entry.title,description:entry.summary,alternates:{canonical:observationHref(entry.slug)},openGraph:{type:"article",title:entry.title,description:entry.summary,url:observationHref(entry.slug),modifiedTime:entry.updated_at}} : {};
}
export default async function Observation({params}:Props) {
  const entry = publicEditorial((await params).slug);
  if (!entry) notFound();
  return <article className="frame page article editorial-page">
    <div className="crumbs"><Link href="/observations">山海观察</Link></div>
    <header className="article-heading"><p className="print-label"><span />山海观察</p><h1>{entry.title}</h1>{entry.origin==="third_party"&&<ThirdPartyReviewNote/>}<p>{entry.summary}</p><div className="article-meta"><time dateTime={day(entry.updated_at)}>编辑于 {day(entry.updated_at)}</time></div></header>
    <div className="editorial-text">{entry.body}</div>
    <section><h2>判断与来源</h2><Evidence editorial={entry.id}/></section>
    <Link className="text-link" href="/policy#evidence">了解内容与核实政策</Link>
  </article>;
}
