import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, LockKeyhole } from "lucide-react";
import { notFound } from "next/navigation";
import { getTool, guideHref, guides, toolHref } from "@/lib/catalog";
import { guideAllowed } from "@/lib/geo/catalog";
import { contentVisibility } from "@/lib/geo/request";
import { IconTile } from "@/components/catalog/icon";
import { ToolWorkspace } from "@/components/tools/workspace";
import { ToolGuideNav } from "@/components/site/tool-guide-nav";

type Props = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tool = getTool((await params).id);
  if (!tool) return {};
  return { title: tool.title, description: tool.description, alternates: { canonical: toolHref(tool.id) } };
}

export default async function ToolPage({ params }: Props) {
  const tool = getTool((await params).id);
  if (!tool) notFound();
  const visibility=await contentVisibility();
  const related = guides.find((guide) => guide.relatedTool === tool.id && guideAllowed(visibility,guide));
  return <div className="frame page"><ToolGuideNav current="tools" />
    <Link className="back-link" href="/tools"><ArrowLeft size={16} aria-hidden="true" />工具中心</Link>
    <div className="detail-heading"><IconTile icon={tool.icon} tone={tool.tone} /><div><h1>{tool.title}</h1><p>{tool.description}</p></div></div>
    <div className="privacy"><LockKeyhole size={16} aria-hidden="true" /> 浏览器本地处理</div>
    <ToolWorkspace id={tool.id} />
    {related && <Link href={guideHref(related.id)} prefetch={false} className="text-link related-link">{related.title} <ArrowRight size={16} aria-hidden="true" /></Link>}
  </div>;
}
