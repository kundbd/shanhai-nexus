"use client";

import { useTranslations } from "@/components/site/language";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Clock3, Search } from "lucide-react";
import { guideKindLabels, type Guide } from "@/lib/catalog/types";
import { IconTile } from "./icon";

type Summary = Omit<Guide, "sources" | "relatedTool" | "relatedGuides" | "diagnosis">;

export function GuideFilters({ guides }: { guides: readonly Summary[] }) {
  const t = useTranslations();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const categories = [...new Set(guides.map((guide) => guide.category))];
  const words = query.normalize("NFKC").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = guides.filter((guide) =>
    (!category || guide.category === category) &&
    (!difficulty || guide.difficulty === difficulty) &&
    words.every((word) => [guide.title, guide.description, ...guide.tags, ...guide.keywords].join(" ").normalize("NFKC").toLowerCase().includes(word)),
  );
  return <>
    <div className="guide-filters">
      <label className="filter-input"><Search size={18} aria-hidden="true" /><input type="search" autoComplete="off" aria-label={t("搜索教程")} placeholder={t("按关键词查找")} maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label><span className="sr-only">{t("类别")}</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">{t("全部分类")}</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span className="sr-only">{t("难度")}</span><select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="">{t("不限难度")}</option><option value="入门">{t("入门")}</option><option value="进阶">{t("进阶")}</option></select></label>
    </div>
    <p className="results-count" aria-live="polite">{t("{count} 篇内容", { count: filtered.length })}</p>
    {filtered.length ? <div className="guides-grid">
      {filtered.map((item) => <Link className="surface guide-card" href={`/guides/${item.id}`} key={item.id}>
        <div className="guide-card-top"><IconTile icon={item.kind === "solution" ? "terminal" : "book"} tone={item.kind === "solution" ? "teal" : "indigo"} compact /><span>{item.category} · {t(guideKindLabels[item.kind])}</span><ArrowUpRight className="card-arrow" size={17} aria-hidden="true" /></div>
        <h2>{item.title}</h2><p>{item.description}</p><div className="guide-card-meta"><span>{t(item.difficulty)}</span><span className="meta-dot" /><Clock3 size={13} aria-hidden="true" />{t("{count} 分钟", { count: item.minutes })}</div>
      </Link>)}
    </div> : <div className="empty surface"><Search size={25} aria-hidden="true" /><h2>{t("没有匹配的教程")}</h2><p>{t("试试更短的关键词或放宽筛选条件。")}</p><button className="button secondary" onClick={() => {setQuery("");setCategory("");setDifficulty("");}}>{t("清除筛选")}</button></div>}
  </>;
}
