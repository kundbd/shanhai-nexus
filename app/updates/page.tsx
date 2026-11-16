import type { Metadata } from "next";
import Link from "next/link";
import { EventList } from "@/components/directory/display";
import { publicIncidents } from "@/lib/directory/read";

export const dynamic = "force-dynamic";
export const metadata:Metadata = {title:"最新动态",description:"查阅有可核实来源的价格、服务状态及政策记录。",alternates:{canonical:"/updates"}};
export default function Updates() {
  return <div className="frame page directory-page editorial-page">
    <div className="catalog-heading"><p className="print-label">评测与观察</p><h1>最新动态</h1><p>按事件发生日排列。每条记录都可回到原始资料。</p></div>
    <p className="section-note"><Link className="text-link" href="/observations">查看山海观察</Link></p>
    <EventList events={publicIncidents()}/>
  </div>;
}
