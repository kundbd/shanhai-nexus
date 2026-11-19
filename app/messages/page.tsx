import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AnnouncementCard } from "@/components/site/announcements";
import { siteAnnouncements, type SiteAnnouncement } from "@/lib/site-announcements";
import { siteServiceRegionClause } from "@/lib/site-consent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    title: t("消息"),
    description: t("山海知序站点公告。"),
    alternates: { canonical: "/messages" },
  };
}

export default async function MessagesPage() {
  const t = await getTranslations();
  const content: Record<SiteAnnouncement["id"], ReactNode> = {
    "site-introduction": (
      <>
        <p><strong>{t("当前可用")}</strong>{t("可查商家档案、商品报价和山海观察。登录后可匿名评价商家，也可以用账号名在社区发帖和互动。")}</p>
        <p><strong>{t("后续维护")}</strong>{t("持续补充商家和商品，定期复核报价和失效链接，审核社区内容并处理纠错。")}<Link className="text-link" href="/contact">{t("提交纠错")}</Link></p>
        <p className="announcement-rule">{t("评论区严禁涉政")}</p>
      </>
    ),
    "registration-code": <p>{t("用户注册时未接收到验证码可以检查垃圾邮箱或者等待片刻")}</p>,
    "network-proxy-region": (
      <>
        <p>{t("即日起，本站不再对中国大陆地区开放网络代理信息服务。中国大陆用户严禁使用 VPN 浏览此类内容，否则后果自负。")}</p>
        <p>{t(siteServiceRegionClause)}</p>
      </>
    ),
  };
  return (
    <div className="frame page messages-page">
      <div className="page-heading"><h1>{t("消息")}</h1></div>
      <div className="announcement-list">
        {siteAnnouncements.map((announcement, index) => (
          <AnnouncementCard key={announcement.id} announcement={announcement} number={index + 1}>
            {content[announcement.id]}
          </AnnouncementCard>
        ))}
      </div>
    </div>
  );
}
