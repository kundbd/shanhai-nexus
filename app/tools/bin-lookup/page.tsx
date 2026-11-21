import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BinLookup } from "@/components/tools/bin-lookup";
import { getTranslations } from "@/lib/i18n/server";
import { binDescription, binLicense, binSource, binTitle, binToolPath } from "@/lib/tools/bin-region";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t(binTitle), description: t(binDescription), alternates: { canonical: binToolPath } };
}

export default async function BinToolPage() {
  const t = await getTranslations();
  return <div className="frame page narrow">
    <Link className="back-link" href="/tools"><ArrowLeft size={16} aria-hidden="true" />{t("工具与指南")}</Link>
    <header className="page-heading">
      <h1>{t(binTitle)}</h1>
      <p>{t(binDescription)}</p>
    </header>
    <BinLookup />
    <p className="section-note bin-source">
      {t("数据来源")}{": "}
      <a className="text-link" href={binSource} rel="noreferrer" target="_blank">Techbuddie Solutions / binlist-data</a>
      {" · "}<a className="text-link" href={binLicense} rel="noreferrer" target="_blank">CC BY 4.0</a>
      {" · "}<a className="text-link" href="/bin-data/NOTICE.txt">{t("数据说明")}</a>
    </p>
  </div>;
}
