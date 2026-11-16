import Link from "next/link";

const items = [
  { href: "/tools", label: "浏览器工具", current: "tools" },
  { href: "/guides", label: "知识中心", current: "guides" },
  { href: "/diagnose", label: "规则诊断", current: "diagnose" },
] as const;

export function ToolGuideNav({ current }: { current: (typeof items)[number]["current"] }) {
  return <nav className="tool-hub" aria-label="工具与指南">
    {items.map((item) => <Link key={item.href} href={item.href} aria-current={item.current === current ? "page" : undefined}>{item.label}</Link>)}
  </nav>;
}
