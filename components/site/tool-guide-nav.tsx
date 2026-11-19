import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";

const items = [
  { href: "/tools", label: "浏览器工具", current: "tools" },
  { href: "/guides", label: "知识中心", current: "guides" },
  { href: "/diagnose", label: "规则诊断", current: "diagnose" },
] as const;

export async function ToolGuideNav({ current }: { current: (typeof items)[number]["current"] }) {
  const t = await getTranslations();
  return <nav className="tool-hub" aria-label={t("工具与指南")}>
    {items.map((item) => <Link key={item.href} href={item.href} aria-current={item.current === current ? "page" : undefined}>{t(item.label)}</Link>)}
  </nav>;
}
