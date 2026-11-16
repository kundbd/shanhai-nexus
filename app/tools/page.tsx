import type { Metadata } from "next";
import { Boxes, LockKeyhole } from "lucide-react";
import { tools } from "@/lib/catalog";
import { ToolCard } from "@/components/catalog/cards";
import { PageHeading } from "@/components/site/page-heading";
import { ToolGuideNav } from "@/components/site/tool-guide-nav";

export const metadata: Metadata = { title: "工具中心", description: "在浏览器中格式化 JSON、转换 Base64 和时间戳，或校验 SHA-256。", alternates: { canonical: "/tools" } };

export default function ToolsPage() {
  return <div className="frame page">
    <PageHeading eyebrow="工具与指南" icon={<Boxes size={17} aria-hidden="true" />} title="工具中心" description="格式化数据、转换编码与日期，或校验文本摘要。" />
    <ToolGuideNav current="tools" />
    <div className="privacy"><LockKeyhole size={16} aria-hidden="true" /> 所有工具均在浏览器内运行，输入不会上传。</div>
    <div className="tools-grid">{tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}</div>
  </div>;
}
