import { Binary, Braces, Clock3, Fingerprint, Globe2, Terminal, Server, BookOpen, Wrench, GitCompareArrows, Link2 } from "lucide-react";
import type { Tone } from "@/lib/catalog/types";

const icons = {
  binary: Binary, braces: Braces, clock: Clock3, fingerprint: Fingerprint, globe: Globe2,
  terminal: Terminal, server: Server, book: BookOpen, tool: Wrench, link: Link2, diff: GitCompareArrows,
};

export function IconTile({ icon, tone = "teal", compact = false }: { icon: string; tone?: Tone; compact?: boolean }) {
  const Icon = icons[icon as keyof typeof icons] ?? BookOpen;
  return <span className={`icon-tile tone-${tone}${compact ? " icon-small" : ""}`}><Icon size={compact ? 17 : 22} strokeWidth={1.8} aria-hidden="true" /></span>;
}
