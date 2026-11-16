"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Brand } from "./brand";
import { ThemeSwitch } from "./theme";

const navigation = [
  { href: "/", label: "首页", match: (path: string) => path === "/" },
  { href: "/services", label: "服务目录", match: (path: string) => path.startsWith("/services") || path.startsWith("/categories/") },
  { href: "/community", label: "评论社区", match: (path: string) => path === "/community" || path.startsWith("/community/") },
  { href: "/observations", label: "评测与观察", match: (path: string) => path.startsWith("/observations") || path.startsWith("/updates") },
  { href: "/tools", label: "工具与指南", match: (path: string) => path.startsWith("/tools") || path.startsWith("/guides") || path.startsWith("/diagnose") },
];

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="frame header-inner">
        <Brand />
        <nav id="main-navigation" aria-label="主导航" className={open ? "main-nav open" : "main-nav"}>
          {navigation.map(({ href, label, match }) => {
            const active = match(path);
            return <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>{label}</Link>;
          })}
        </nav>
        <div className="header-actions">
          <Link href="/account" prefetch={false} className="header-account" aria-current={path==="/account"?"page":undefined}>个人中心</Link>
          <ThemeSwitch />
          <button className="icon-button menu-button" aria-label={open ? "关闭菜单" : "打开菜单"} aria-expanded={open} aria-controls="main-navigation" onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
    </header>
  );
}
