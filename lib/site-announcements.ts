export const siteAnnouncements = [
  { id: "site-introduction", title: "站点公告" },
  { id: "registration-code", title: "注册验证码提醒" },
] as const;

export type SiteAnnouncement = (typeof siteAnnouncements)[number];
