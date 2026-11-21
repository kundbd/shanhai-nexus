import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Tool } from "@/lib/catalog/types";
import { IconTile } from "./icon";

export async function ToolCard({ tool }: { tool: Tool }) {
  const t = await getTranslations();
  return (
    <Link className="tool-card surface" href={tool.href}>
      <div className="tool-card-top"><IconTile icon={tool.icon} tone={tool.tone} /><ArrowUpRight className="card-arrow" size={19} aria-hidden="true" /></div>
      <h2>{t(tool.title)}</h2>
      <p>{t(tool.description)}</p>
    </Link>
  );
}
