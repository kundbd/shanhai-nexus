"use client";

import { useTranslations } from "@/components/site/language";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Github, Menu, Send, X } from "lucide-react";
import { useState } from "react";
import { brand } from "@/lib/brand";
import { MessagesLink } from "./announcements";
import { Brand } from "./brand";
import { ThemeSwitch } from "./theme";

const navigation = [
  { href: "/", label: "首页", match: (path: string) => path === "/" },
  { href: "/services", label: "服务目录", match: (path: string) => path.startsWith("/services") || path.startsWith("/categories/") || path.startsWith("/products/") },
  { href: "/rankings", label: "排行榜", match: (path: string) => path === "/rankings" },
  { href: "/community", label: "评论社区", match: (path: string) => path === "/community" || path.startsWith("/community/") },
  { href: "/observations", label: "评测与观察", match: (path: string) => path.startsWith("/observations") || path.startsWith("/updates") },
  { href: "/tools", label: "工具与指南", match: (path: string) => path.startsWith("/tools") || path.startsWith("/guides") || path.startsWith("/diagnose") },
];

function ContactLinks({inMenu=false}:{inMenu?:boolean}) {
  const t = useTranslations();
  const label = t("合作与反馈");
  return <div role="group" aria-label={label} className={`header-contact-links${inMenu?" header-contact-links-menu":""}`}>
    <span className="header-contact-label" aria-hidden="true">{label}</span>
    <a href={brand.repositoryUrl} target="_blank" rel="noreferrer" aria-label={t("山海知序 GitHub")} title={t("山海知序 GitHub")}>
      <Github size={19} aria-hidden="true"/>
    </a>
    <a className="header-telegram" href={brand.telegramUrl} target="_blank" rel="noreferrer" aria-label={t("通过 Telegram 联系")} title={t("通过 Telegram 联系")}>
      <Send size={18} aria-hidden="true"/>
    </a>
    <a href={`mailto:${brand.cooperationEmail}`} aria-label={t("发送邮件至 {email}", { email: brand.cooperationEmail })} title={brand.cooperationEmail}>
      <Image src="/contact-icons/gmail.png" width={20} height={20} alt="" unoptimized/>
    </a>
  </div>;
}

export function Header({ region }: { region: React.ReactNode }) {
  const t = useTranslations();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      {region}
      <div className="frame header-inner">
        <div className="header-brand"><Brand homeLabel={t("首页")} /><ContactLinks /></div>
        <nav id="main-navigation" aria-label={t("主导航")} className={open ? "main-nav open" : "main-nav"}>
          {navigation.map(({ href, label, match }) => {
            const active = match(path);
            return <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>{t(label)}</Link>;
          })}
          {open&&<ContactLinks inMenu />}
        </nav>
        <div className="header-actions">
          <MessagesLink active={path === "/messages"} onClick={() => setOpen(false)} />
          <Link href="/account" prefetch={false} className="header-account" aria-current={path==="/account"?"page":undefined}>{t("个人中心")}</Link>
          <ThemeSwitch />
          <button className="icon-button menu-button" aria-label={open ? t("关闭菜单") : t("打开菜单")} aria-expanded={open} aria-controls="main-navigation" onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
    </header>
  );
}
