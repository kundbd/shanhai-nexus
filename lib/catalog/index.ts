import { binDescription, binTitle, binToolPath } from "@/lib/tools/bin-region";
import { billingDescription, billingTitle, billingToolPath } from "@/lib/tools/billing-address";
import { totpDescription, totpTitle, totpToolPath } from "@/lib/tools/totp";
import type { Tool } from "./types";

export const tools: readonly Tool[] = [{
  id: "bin-lookup",
  title: binTitle,
  description: binDescription,
  category: "支付工具",
  href: binToolPath,
  icon: "credit-card",
  tone: "teal",
  tags: ["银行卡", "BIN", "IIN", "发卡地区"],
  keywords: ["bin查询", "银行卡地区识别", "卡段查询", "銀行卡 BIN 地區查詢",
    "發卡地區", "BIN lookup", "IIN lookup", "card BIN region lookup", "card issuer country"],
}, {
  id: "2fa",
  title: totpTitle,
  description: totpDescription,
  category: "工具",
  href: totpToolPath,
  icon: "shield-check",
  tone: "blue",
  tags: ["2FA", "TOTP", "Base32"],
  keywords: ["两步验证", "双重认证", "動態驗證碼", "two-factor authentication", "authenticator"],
}, {
  id: "us-billing-address",
  title: billingTitle,
  description: billingDescription,
  category: "支付工具",
  href: billingToolPath,
  icon: "map-pin",
  tone: "amber",
  tags: ["美国账单地址", "免税州", "邮政编码"],
  keywords: ["美区免税州账单地址生成器", "美區帳單地址", "US billing address", "US address generator", "ZIP code"],
}];
