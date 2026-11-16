import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarCheck, Clock3 } from "lucide-react";
import { getGuide, getTool, guideHref, guides, toolHref } from "@/lib/catalog";
import { readArticle } from "@/lib/catalog/articles";
import { guideKindLabels } from "@/lib/catalog/types";
import { diagnosisHref } from "@/lib/diagnosis";
import Markdown from "react-markdown";
import { ToolGuideNav } from "@/components/site/tool-guide-nav";

type Props = { params: Promise<{ id: string }> };
export function generateStaticParams() { return guides.map(({ id }) => ({ id })); }
export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = getGuide((await params).id);
  if (!guide) return {};
  return { title: guide.title, description: guide.description, alternates: { canonical: guideHref(guide.id) }, openGraph: { title: guide.title, description: guide.description, type: "article", modifiedTime: guide.verified } };
}

export default async function GuidePage({ params }: Props) {
  const guide = getGuide((await params).id);
  if (!guide) notFound();
  const tool = guide.relatedTool ? getTool(guide.relatedTool) : undefined;
  return <article className="frame page article"><ToolGuideNav current="guides" />
    <Link className="back-link" href="/guides"><ArrowLeft size={16} aria-hidden="true" />知识中心</Link>
    <header className="article-heading">
      <div className="eyebrow">{guide.category} / {guideKindLabels[guide.kind]}</div>
      <h1>{guide.title}</h1><p>{guide.description}</p>
      <div className="article-meta"><span className="chip">{guide.difficulty}</span><span><Clock3 size={15} aria-hidden="true" />{guide.minutes} 分钟</span><span><CalendarCheck size={15} aria-hidden="true" />最后验证 {guide.verified}</span></div>
    </header>
    <div className="article-prose"><Markdown>{readArticle(guide.id)}</Markdown></div>
    {(tool || guide.diagnosis) && <div className="article-actions">
      {tool && <Link className="button primary" href={toolHref(tool.id)}>打开{tool.title} <ArrowRight size={16} aria-hidden="true" /></Link>}
      {guide.diagnosis && <Link className="button primary" href={diagnosisHref(guide.diagnosis, guide.id === "api-429" ? "429" : undefined)}>开始交互式诊断 <ArrowRight size={16} aria-hidden="true" /></Link>}
    </div>}
    {!!guide.relatedGuides?.length && <section className="references"><h2>关联问题</h2><ul>{guide.relatedGuides.map(getGuide).map((item) => item && <li key={item.id}><Link href={guideHref(item.id)}>{item.title} <ArrowRight size={16} aria-hidden="true" /></Link></li>)}</ul></section>}
    <section className="references"><h2>参考资料</h2><ul>{guide.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} <ArrowUpRight size={16} aria-hidden="true" /></a></li>)}</ul></section>
  </article>;
}
