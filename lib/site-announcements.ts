type AnnouncementEntry = { id: string; title: string } & (
  | { publishedAt: string }
  | { id: "site-introduction" | "registration-code"; publishedAt?: never }
);

export const registrationCodeAdvice = "用户注册时未接收到验证码可以检查垃圾邮箱或者等待片刻";

export const siteAnnouncements = [
  { id: "site-introduction", title: "站点公告" },
  { id: "registration-code", title: "注册验证码提醒" },
  { id: "network-proxy-region", title: "网络代理信息服务地区公告", publishedAt: "2026-11-19T20:54:00+08:00" },
] as const satisfies readonly AnnouncementEntry[];

export type SiteAnnouncement = (typeof siteAnnouncements)[number];
import { siteServiceRegionClause } from "./site-consent";


export const announcementText = {
  "site-introduction": [
    "可查商家档案、商品报价和山海观察。登录后可匿名评价商家，也可以用账号名在社区发帖和互动。",
    "持续补充商家和商品，定期复核报价和失效链接，审核社区内容并处理纠错。",
    "评论区严禁涉政",
  ],
  "registration-code": [registrationCodeAdvice],
  "network-proxy-region": [
    "即日起，本站不再对中国大陆地区开放网络代理信息服务。中国大陆用户严禁使用 VPN 浏览此类内容，否则后果自负。",
    siteServiceRegionClause,
  ],
} as const satisfies Record<SiteAnnouncement["id"], readonly string[]>;
