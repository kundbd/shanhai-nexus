import { getTranslations } from "@/lib/i18n/server";
import { ArrowRight, Search } from "lucide-react";
import { MAX_QUERY_LENGTH } from "@/lib/search/query";

export async function SearchBox({ query = "", hero = false }: { query?: string; hero?: boolean }) {
  const t = await getTranslations();
  return (
    <form action="/search" role="search" className={hero ? "search-box hero-search" : "search-box"}>
      <Search size={22} strokeWidth={1.75} aria-hidden="true" />
      <input aria-label={t("描述你想解决的问题")} name="q" type="search" maxLength={MAX_QUERY_LENGTH} defaultValue={query} placeholder={hero ? t("例如：PDF 怎么转 Word？") : t("输入问题或关键词")} autoComplete="off" spellCheck={false} required />
      <button type="submit" className="button primary">{t("搜索")}<span className="search-arrow"><ArrowRight size={17} aria-hidden="true" /></span></button>
    </form>
  );
}
