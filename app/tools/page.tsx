import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { tools } from "@/lib/catalog";
import { ToolCard } from "@/components/catalog/cards";
import { binDescription } from "@/lib/tools/bin-region";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("工具与指南"), description: t(binDescription), alternates: { canonical: "/tools" } };
}

export default async function ToolsPage() {
  const t = await getTranslations();
  return <div className="frame page">
    <header className="page-heading"><h1>{t("工具与指南")}</h1></header>
    <div className="tools-grid">{tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}</div>
  </div>;
}
