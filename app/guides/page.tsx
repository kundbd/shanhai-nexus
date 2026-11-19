import type { Metadata } from "next";
import { BookOpenText } from "lucide-react";
import { guides } from "@/lib/catalog";
import { GuideFilters } from "@/components/catalog/guide-filters";
import { PageHeading } from "@/components/site/page-heading";
import { ToolGuideNav } from "@/components/site/tool-guide-nav";
import { guideAllowed } from "@/lib/geo/catalog";
import { contentVisibility } from "@/lib/geo/request";

export const metadata: Metadata = { title: "知识中心", description: "浏览数字工具教程和 API、SSH、DNS 排障方案，通过分类、难度和关键词查找。", alternates: { canonical: "/guides" } };

export default async function GuidesPage() {
  const visibility=await contentVisibility();
  return <div className="frame page">
    <PageHeading eyebrow="工具与指南" icon={<BookOpenText size={17} aria-hidden="true" />} title="知识中心" description="从日常办公到开发调试，按步骤完成任务或排查问题。" />
    <ToolGuideNav current="guides" />
    <GuideFilters guides={guides.filter(guide=>guideAllowed(visibility,guide)).map(({ id, title, description, kind, category, difficulty, minutes, verified, tags, keywords }) => ({ id, title:visibility.filterText(title), description:visibility.filterText(description), kind, category, difficulty, minutes, verified, tags, keywords }))} />
  </div>;
}
