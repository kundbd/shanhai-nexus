import { getTranslations } from "@/lib/i18n/server";
import { Search } from "lucide-react";

export async function PublicSearch({ q = "", action = "/search" }: { q?: string; action?: string }) {
  const t = await getTranslations();
  return <form action={action} role="search" className="public-search">
    <Search size={19} aria-hidden="true" /><input key={q} type="search" name="q" maxLength={160} defaultValue={q} aria-label={t("搜索服务商、域名或关键词")} placeholder={t("搜索服务商、域名或关键词")} autoComplete="off" />
    <button type="submit" className="button primary">{t("搜索")}</button>
  </form>;
}
