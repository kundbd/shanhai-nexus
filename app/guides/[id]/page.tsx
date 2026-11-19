import { getSiteLanguage, getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarCheck, Clock3 } from "lucide-react";
import { getGuide, getTool, guideHref, toolHref } from "@/lib/catalog";
import { readArticle } from "@/lib/catalog/articles";
import { guideKindLabels, type Guide } from "@/lib/catalog/types";
import { catalogLinkAllowed, guideAllowed } from "@/lib/geo/catalog";
import { contentVisibility, universalVisibility } from "@/lib/geo/request";
import { diagnosisHref } from "@/lib/diagnosis";
import Markdown from "react-markdown";
import { ToolGuideNav } from "@/components/site/tool-guide-nav";

type Props = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = getGuide((await params).id);
  if (!guide || !guideAllowed(await contentVisibility(),guide)) return { robots:{index:false,follow:false} };
  const t = await getTranslations();
  const title = t(guide.title), description = t(guide.description);
  return { title, description, alternates: { canonical: guideHref(guide.id) }, openGraph: { title, description, type: "article", modifiedTime: guide.verified },
    ...(!guideAllowed(universalVisibility(),guide) && {robots:{index:false,follow:false}}) };
}

export default async function GuidePage({ params }: Props) {
  const t = await getTranslations();
  const guide = getGuide((await params).id);
  const visibility = await contentVisibility();
  if (!guide || !guideAllowed(visibility,guide)) notFound();
  const tool = guide.relatedTool ? getTool(guide.relatedTool) : undefined;
  const related = guide.relatedGuides?.map(getGuide).filter((item): item is Guide => Boolean(item&&guideAllowed(visibility,item))) ?? [];
  const sources = guide.sources.filter(source=>catalogLinkAllowed(visibility,source.url));
  return <article className="frame page article"><ToolGuideNav current="guides" />
    <Link className="back-link" href="/guides"><ArrowLeft size={16} aria-hidden="true" />{t("知识中心")}</Link>
    <header className="article-heading">
      <div className="eyebrow">{t(guide.category)} / {t(guideKindLabels[guide.kind])}</div>
      <h1>{t(guide.title)}</h1><p>{t(guide.description)}</p>
      <div className="article-meta"><span className="chip">{t(guide.difficulty)}</span><span><Clock3 size={15} aria-hidden="true" />{t("{count} 分钟", { count: guide.minutes })}</span><span><CalendarCheck size={15} aria-hidden="true" />{t("最后验证")}{" "}{guide.verified}</span></div>
    </header>
    {(await getSiteLanguage()) !== "zh-CN" && <p className="section-note">{t("源资料为简体中文")}</p>}
    <div className="article-prose" lang="zh-CN"><Markdown components={{
      a: ({href,children,title}) => href && catalogLinkAllowed(visibility,href) ? <a href={href} title={title}>{children}</a> : null,
    }}>{visibility.filterText(readArticle(guide.id))}</Markdown></div>
    {(tool || guide.diagnosis) && <div className="article-actions">
      {tool && <Link className="button primary" href={toolHref(tool.id)}>{t("打开 {title}", { title: t(tool.title) })} <ArrowRight size={16} aria-hidden="true" /></Link>}
      {guide.diagnosis && <Link className="button primary" href={diagnosisHref(guide.diagnosis, guide.id === "api-429" ? "429" : undefined)}>{t("开始交互式诊断")}{" "}<ArrowRight size={16} aria-hidden="true" /></Link>}
    </div>}
    {!!related.length && <section className="references"><h2>{t("关联问题")}</h2><ul>{related.map(item=><li key={item.id}><Link href={guideHref(item.id)} prefetch={false}>{t(item.title)} <ArrowRight size={16} aria-hidden="true" /></Link></li>)}</ul></section>}
    {!!sources.length&&<section className="references"><h2>{t("参考资料")}</h2><ul>{sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} <ArrowUpRight size={16} aria-hidden="true" /></a></li>)}</ul></section>}
  </article>;
}
