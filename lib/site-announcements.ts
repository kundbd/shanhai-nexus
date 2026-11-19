type AnnouncementEntry = { id: string; title: string } & (
  | { publishedAt: string }
  | { id: "site-introduction" | "registration-code"; publishedAt?: never }
);

export const siteAnnouncements = [
  { id: "site-introduction", title: "站点公告" },
  { id: "registration-code", title: "注册验证码提醒" },
  { id: "network-proxy-region", title: "网络代理信息服务地区公告", publishedAt: "2026-11-19T20:54:00+08:00" },
] as const satisfies readonly AnnouncementEntry[];

export type SiteAnnouncement = (typeof siteAnnouncements)[number];
