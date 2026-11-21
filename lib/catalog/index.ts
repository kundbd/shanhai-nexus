import { binDescription, binTitle, binToolPath } from "@/lib/tools/bin-region";
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
}];
