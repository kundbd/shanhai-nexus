import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AnnouncementCard } from "@/components/site/announcements";
import { siteAnnouncements, type SiteAnnouncement } from "@/lib/site-announcements";

export const metadata: Metadata = {
  title: "消息",
  description: "山海知序站点公告。",
  alternates: { canonical: "/messages" },
};

const announcementContent: Record<SiteAnnouncement["id"], ReactNode> = {
  "site-introduction": (
    <>
      <p><strong>当前可用</strong>可查商家档案、商品报价和山海观察。登录后可匿名评价商家，也可以用账号名在社区发帖和互动。</p>
      <p><strong>后续维护</strong>持续补充商家和商品，定期复核报价和失效链接，审核社区内容并处理纠错。<Link className="text-link" href="/contact">提交纠错</Link></p>
      <p className="announcement-rule">评论区严禁涉政</p>
    </>
  ),
  "registration-code": <p>用户注册时未接收到验证码可以检查垃圾邮箱或者等待片刻</p>,
};

export default function MessagesPage() {
  return (
    <div className="frame page messages-page">
      <div className="page-heading"><h1>消息</h1></div>
      <div className="announcement-list">
        {siteAnnouncements.map((announcement, index) => (
          <AnnouncementCard key={announcement.id} announcement={announcement} number={index + 1}>
            {announcementContent[announcement.id]}
          </AnnouncementCard>
        ))}
      </div>
    </div>
  );
}
