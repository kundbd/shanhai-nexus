import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Clock3 } from "lucide-react";
import { guideHref, toolHref } from "@/lib/catalog";
import type { Guide, Tool } from "@/lib/catalog/types";
import { IconTile } from "./icon";

export async function ToolCard({ tool }: { tool: Tool }) {
  const t = await getTranslations();
  return (
    <Link className="tool-card surface" href={toolHref(tool.id)}>
      <div className="tool-card-top"><IconTile icon={tool.icon} tone={tool.tone} /><ArrowUpRight className="card-arrow" size={19} aria-hidden="true" /></div>
      <h3>{t(tool.title)}</h3>
      <p>{t(tool.description)}</p>
      <span className="card-category">{t(tool.category)}</span>
    </Link>
  );
}

export async function GuideRow({ guide }: { guide: Guide }) {
  const t = await getTranslations();
  return (
    <Link className="guide-row" href={guideHref(guide.id)}>
      <IconTile icon="book" tone={guide.category === "文档办公" ? "teal" : "indigo"} compact />
      <div className="row-copy">
        <h3>{t(guide.title)}</h3>
        <span>{t(guide.category)}<span className="meta-dot" />{t(guide.difficulty)}<span className="meta-dot" /><Clock3 size={12} aria-hidden="true" /> {t("{count} 分钟", { count: guide.minutes })}</span>
      </div>
      <ArrowRight className="card-arrow" size={17} aria-hidden="true" />
    </Link>
  );
}
