import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AnnouncementCard } from "@/components/site/announcements";
import { announcementText, siteAnnouncements, type SiteAnnouncement } from "@/lib/site-announcements";

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
        <p><strong>{t("当前可用")}</strong>{t(announcementText["site-introduction"][0])}</p>
        <p><strong>{t("后续维护")}</strong>{t(announcementText["site-introduction"][1])}<Link className="text-link" href="/contact">{t("提交纠错")}</Link></p>
        <p className="announcement-rule">{t(announcementText["site-introduction"][2])}</p>
      </>
    ),
    "registration-code": <p>{t(announcementText["registration-code"][0])}</p>,
    "network-proxy-region": (
      <>
        {announcementText["network-proxy-region"].map(paragraph => <p key={paragraph}>{t(paragraph)}</p>)}
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
