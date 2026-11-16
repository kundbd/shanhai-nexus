import type { Metadata } from "next";
import { ScanLine } from "lucide-react";
import { PageHeading } from "@/components/site/page-heading";
import { ToolGuideNav } from "@/components/site/tool-guide-nav";
import { DiagnosisWizard } from "@/components/diagnosis/wizard";
import { diagnosisService } from "@/lib/diagnosis";

export const metadata: Metadata = { title: "规则诊断", description: "根据可见报错，按预设规则逐步排查 AI API 401、403、429、SSH 连接及域名解析问题。", alternates: { canonical: "/diagnose" } };

export default async function DiagnosePage({ searchParams }: { searchParams: Promise<{ topic?: string | string[]; issue?: string | string[] }> }) {
  const { topic, issue } = await searchParams;
  const initialTopic = typeof topic === "string" && diagnosisService.find(topic) ? topic : "";
  const initialStep = initialTopic === "api" && issue === "429" && diagnosisService.find(initialTopic)?.nodes.limit ? "limit" : "";
  return <div className="frame page">
    <PageHeading eyebrow="工具与指南" icon={<ScanLine size={17} aria-hidden="true" />} title="智能诊断" description="按站点内预设规则逐步排查，不是实时人工智能推理。请根据你看到的报错选择对应步骤。" />
    <ToolGuideNav current="diagnose" />
    <DiagnosisWizard key={`${initialTopic}:${initialStep}`} flows={diagnosisService.topics} initialTopic={initialTopic} initialStep={initialStep} />
  </div>;
}
