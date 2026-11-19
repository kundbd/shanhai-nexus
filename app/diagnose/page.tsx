import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { ScanLine } from "lucide-react";
import { PageHeading } from "@/components/site/page-heading";
import { ToolGuideNav } from "@/components/site/tool-guide-nav";
import { DiagnosisWizard } from "@/components/diagnosis/wizard";
import { diagnosisService } from "@/lib/diagnosis";
import { catalogLinkAllowed } from "@/lib/geo/catalog";
import { contentVisibility } from "@/lib/geo/request";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("规则诊断"), description: t("根据可见报错，按预设规则逐步排查 AI API 401、403、429、SSH 连接及域名解析问题。"), alternates: { canonical: "/diagnose" } };
}

export default async function DiagnosePage({ searchParams }: { searchParams: Promise<{ topic?: string | string[]; issue?: string | string[] }> }) {
  const t = await getTranslations();
  const { topic, issue } = await searchParams;
  const visibility=await contentVisibility();
  const flows=Object.fromEntries(Object.entries(diagnosisService.topics).map(([id,flow])=>[id,{
    ...flow, label: t(flow.label), description: t(flow.description),
    relatedTool: flow.relatedTool && { ...flow.relatedTool, label: t(flow.relatedTool.label) },
    nodes: Object.fromEntries(Object.entries(flow.nodes).map(([key, node]) => [key,
      "question" in node
        ? { ...node, question: t(node.question), options: node.options.map(option => ({ ...option, label: t(option.label) })) }
        : { ...node, title: t(node.title), steps: node.steps.map(step => t(step)), guide: catalogLinkAllowed(visibility, `/guides/${node.guide}`) ? node.guide : "" },
    ])),
  }]));
  const initialTopic = typeof topic === "string" && diagnosisService.find(topic) ? topic : "";
  const initialStep = initialTopic === "api" && issue === "429" && diagnosisService.find(initialTopic)?.nodes.limit ? "limit" : "";
  return <div className="frame page">
    <PageHeading eyebrow={t("工具与指南")} icon={<ScanLine size={17} aria-hidden="true" />} title={t("智能诊断")} description={t("按站点内预设规则逐步排查，不是实时人工智能推理。请根据你看到的报错选择对应步骤。")} />
    <ToolGuideNav current="diagnose" />
    <DiagnosisWizard key={`${initialTopic}:${initialStep}`} flows={flows} initialTopic={initialTopic} initialStep={initialStep} />
  </div>;
}
