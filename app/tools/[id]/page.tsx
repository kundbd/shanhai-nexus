import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, LockKeyhole } from "lucide-react";
import { notFound } from "next/navigation";
import { getTool, guideHref, guides, toolHref, tools } from "@/lib/catalog";
import { IconTile } from "@/components/catalog/icon";
import { ToolWorkspace } from "@/components/tools/workspace";
import { ToolGuideNav } from "@/components/site/tool-guide-nav";

type Props = { params: Promise<{ id: string }> };
export function generateStaticParams() { return tools.map(({ id }) => ({ id })); }
export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tool = getTool((await params).id);
  if (!tool) return {};
  return { title: tool.title, description: tool.description, alternates: { canonical: toolHref(tool.id) } };
}

export default async function ToolPage({ params }: Props) {
  const tool = getTool((await params).id);
  if (!tool) notFound();
  const related = guides.find((guide) => guide.relatedTool === tool.id);
  return <div className="frame page"><ToolGuideNav current="tools" />
    <Link className="back-link" href="/tools"><ArrowLeft size={16} aria-hidden="true" />工具中心</Link>
    <div className="detail-heading"><IconTile icon={tool.icon} tone={tool.tone} /><div><h1>{tool.title}</h1><p>{tool.description}</p></div></div>
    <div className="privacy"><LockKeyhole size={16} aria-hidden="true" /> 浏览器本地处理</div>
    <ToolWorkspace id={tool.id} />
    {related && <Link href={guideHref(related.id)} className="text-link related-link">{related.title} <ArrowRight size={16} aria-hidden="true" /></Link>}
  </div>;
}
