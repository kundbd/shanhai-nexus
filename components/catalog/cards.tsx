import Link from "next/link";
import { ArrowRight, ArrowUpRight, Clock3 } from "lucide-react";
import { guideHref, toolHref } from "@/lib/catalog";
import type { Guide, Tool } from "@/lib/catalog/types";
import { IconTile } from "./icon";

export function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Link className="tool-card surface" href={toolHref(tool.id)}>
      <div className="tool-card-top"><IconTile icon={tool.icon} tone={tool.tone} /><ArrowUpRight className="card-arrow" size={19} aria-hidden="true" /></div>
      <h3>{tool.title}</h3>
      <p>{tool.description}</p>
      <span className="card-category">{tool.category}</span>
    </Link>
  );
}

export function GuideRow({ guide }: { guide: Guide }) {
  return (
    <Link className="guide-row" href={guideHref(guide.id)}>
      <IconTile icon="book" tone={guide.category === "文档办公" ? "teal" : "indigo"} compact />
      <div className="row-copy">
        <h3>{guide.title}</h3>
        <span>{guide.category}<span className="meta-dot" />{guide.difficulty}<span className="meta-dot" /><Clock3 size={12} aria-hidden="true" /> {guide.minutes} 分钟</span>
      </div>
      <ArrowRight className="card-arrow" size={17} aria-hidden="true" />
    </Link>
  );
}
