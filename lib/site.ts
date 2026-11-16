export const siteDescription = "山海知序是独立数字服务评测与消费指南，整理 AI、支付及网络服务的公开价格、使用条件和有来源的事件记录。";

export function siteUrl(): URL {
  const address = process.env.SITE_URL ?? "http://localhost:3000";
  const url = new URL(address);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SITE_URL must be an HTTP(S) origin.");
  }
  return url;
}
