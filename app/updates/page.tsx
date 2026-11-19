import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { EventList } from "@/components/directory/display";
import { publicIncidents } from "@/lib/directory/read";
import { contentVisibility } from "@/lib/geo/request";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {title:t("最新动态"),description:t("查阅有可核实来源的价格、服务状态及政策记录。"),alternates:{canonical:"/updates"}};
}
export default async function Updates() {
  const t = await getTranslations();
  const visibility=await contentVisibility();
  return <div className="frame page directory-page editorial-page">
    <div className="catalog-heading"><p className="print-label">{t("评测与观察")}</p><h1>{t("最新动态")}</h1><p>{t("按事件发生日排列。每条记录都可回到原始资料。")}</p></div>
    <p className="section-note"><Link className="text-link" href="/observations">{t("查看山海观察")}</Link></p>
    <EventList events={publicIncidents(undefined,undefined,undefined,visibility)}/>
  </div>;
}
