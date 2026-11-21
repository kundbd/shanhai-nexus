import { binDescription, binTitle, binToolPath } from "@/lib/tools/bin-region";
import { billingDescription, billingTitle, billingToolPath } from "@/lib/tools/billing-address";
import { envDescription, envTitle, envToolPath } from "@/lib/tools/env-check";
import { feeDescription, feeTitle, feeToolPath } from "@/lib/tools/fee-calculator";
import { accountHelperDescription, accountHelperPath, accountHelperTitle } from "@/lib/tools/account-helper";
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
}, {
  id: "env-check",
  title: envTitle,
  description: envDescription,
  category: "工具",
  href: envToolPath,
  icon: "monitor",
  tone: "indigo",
  tags: ["浏览器自检", "WebRTC", "时区"],
  keywords: ["出海环境自检", "瀏覽器環境自檢", "IP 地区一致性", "browser environment check", "timezone check"],
}, {
  id: "fee-calculator",
  title: feeTitle,
  description: feeDescription,
  category: "支付工具",
  href: feeToolPath,
  icon: "calculator",
  tone: "blue",
  tags: ["充值手续费", "汇率", "U 卡"],
  keywords: ["跨境订阅成本", "跨境訂閱成本", "外币费用", "subscription cost calculator", "top-up fees"],
}, {
  id: "account-helper",
  title: accountHelperTitle,
  description: accountHelperDescription,
  category: "工具",
  href: accountHelperPath,
  icon: "key-round",
  tone: "teal",
  tags: ["随机密码", "英文名", "注册资料"],
  keywords: ["密码生成器", "密碼產生器", "随机用户名", "password generator", "test profile generator"],
}];
