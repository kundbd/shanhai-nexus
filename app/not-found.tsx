import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function NotFound() {
  const t = await getTranslations();
  return <div className="frame page narrow"><div className="empty surface"><h1>{t("页面暂不可用")}</h1><p>{t("页面可能已移动，或在当前内容地区暂未开放。")}</p><Link className="button primary" href="/"><ArrowLeft size={16} aria-hidden="true" />{" "}{t("返回首页")}</Link></div></div>;
}
