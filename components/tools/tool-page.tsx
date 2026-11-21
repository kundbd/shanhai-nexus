import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { getTranslations } from "@/lib/i18n/server";

export async function toolMetadata(title: string, description: string, path: string): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t(title), description: t(description), alternates: { canonical: path } };
}

export async function ToolPage({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const t = await getTranslations();
  return <div className="frame page narrow">
    <Link className="back-link" href="/tools"><ArrowLeft size={16} aria-hidden="true" />{t("工具与指南")}</Link>
    <header className="page-heading"><h1>{t(title)}</h1><p>{t(description)}</p></header>
    {children}
  </div>;
}
