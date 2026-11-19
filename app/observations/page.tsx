import type { Metadata } from "next";
import Link from "next/link";
import { ObservationLink } from "@/components/directory/display";
import { publicEditorials } from "@/lib/directory/read";
import { contentVisibility } from "@/lib/geo/request";

export const dynamic = "force-dynamic";
export const metadata:Metadata = {title:"评测与观察",description:"以可追溯来源整理数字服务的价格、条件和消费问题。",alternates:{canonical:"/observations"}};

export default async function Observations() {
  const entries = publicEditorials(undefined,undefined,undefined,await contentVisibility());
  return <div className="frame page directory-page editorial-page">
    <div className="catalog-heading"><p className="print-label">评测与观察</p><h1>山海观察</h1><p>消费指南与第三方测评摘要，附可查阅的原始来源。</p></div>
    <p className="section-note"><Link className="text-link" href="/updates">查看最新动态</Link></p>
    <div className="story-index">{entries.map((entry)=><ObservationLink key={entry.id} entry={entry}/>)}</div>
    {!entries.length && <p className="plain-empty">暂无已发布的观察。</p>}
  </div>;
}
