import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { Boxes, LockKeyhole } from "lucide-react";
import { tools } from "@/lib/catalog";
import { ToolCard } from "@/components/catalog/cards";
import { PageHeading } from "@/components/site/page-heading";
import { ToolGuideNav } from "@/components/site/tool-guide-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("工具中心"), description: t("在浏览器中格式化 JSON、转换 Base64 和时间戳，或校验 SHA-256。"), alternates: { canonical: "/tools" } };
}

export default async function ToolsPage() {
  const t = await getTranslations();
  return <div className="frame page">
    <PageHeading eyebrow={t("工具与指南")} icon={<Boxes size={17} aria-hidden="true" />} title={t("工具中心")} description={t("格式化数据、转换编码与日期，或校验文本摘要。")} />
    <ToolGuideNav current="tools" />
    <div className="privacy"><LockKeyhole size={16} aria-hidden="true" />{" "}{t("所有工具均在浏览器内运行，输入不会上传。")}</div>
    <div className="tools-grid">{tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}</div>
  </div>;
}
