import { CreditCard, MapPin, Monitor, ShieldCheck, Wrench } from "lucide-react";
import type { Tone } from "@/lib/catalog/types";

const icons = {
  "credit-card": CreditCard, "map-pin": MapPin, monitor: Monitor, "shield-check": ShieldCheck, tool: Wrench,
};

export function IconTile({ icon, tone = "teal", compact = false }: { icon: string; tone?: Tone; compact?: boolean }) {
  const Icon = icons[icon as keyof typeof icons] ?? Wrench;
  return <span className={`icon-tile tone-${tone}${compact ? " icon-small" : ""}`}><Icon size={compact ? 17 : 22} strokeWidth={1.8} aria-hidden="true" /></span>;
}
