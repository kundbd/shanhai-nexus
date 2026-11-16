import { canonicalize, MAX_QUERY_LENGTH } from "@/lib/search/query";
import { comparablePeriod } from "./price-board";
import type { Price } from "./types";

type Field = { text: string; weight: number };

const aliases = [
  [/\bg[\s_.-]+p[\s_.-]+t\b/gu, "gpt"],
  [/\b(?:chat[\s_.-]*gpt|chatgtp)\b/gu, "chatgpt"],
  [/克劳德|克洛德/gu, " claude "],
  [/谷歌\s*ai|\bgoogle\s+ai\b|双子座\s*ai/gu, " gemini "],
  [/深度求索|\bdeep[\s_.-]+seek\b/gu, " deepseek "],
  [/通义千问|阿里千问|千问/gu, " qwen "],
  [/\bmoonshot\b|月之暗面/gu, " kimi "],
  [/豆包/gu, " doubao "],
  [/\b(?:ai\s*)?(?:api|llm)[\s-]*(?:relay|proxy|gateway|aggregator)\b|(?:ai\s*)?api\s*(?:中转(?:站)?|转发|反代|网关|聚合|代理)|(?:ai|模型)(?:api\s*)?(?:接口网关|网关)/gu, " api中转 "],
  [/\b(?:ai\s*)?subscription\s+resellers?\b|(?:ai\s*)?会员(?:订阅)?代充|订阅代充|\bai\s*代充|代充值/gu, " 代充 "],
  [/\b(?:ai\s*)?card\s*shops?\b|(?:ai\s*)?(?:发卡网站|自动发卡(?:站)?|发卡商城|发卡网|发卡平台|发卡站|卡网)|^发卡$/gu, " 卡网 "],
  [/(?:\bai\s*)?成品(?:(?:账|帐)号|号)/gu, " 成品号 "],
  [/(?:家庭组|共享|合租)(?:车位|席位)|共享(?:账|帐)号|(?:账|帐)号共享|共享(?=\s|$|\d)|拼车/gu, " 共享席位 "],
  [/卡(?:密兑换|券兑换)|兑换码/gu, " 卡密 "],
  [/短信接码|接马|手机号验证|短信验证|\bsms verification\b/gu, " 接码 "],
  [/梯子|机场订阅|节点订阅|订阅节点|\b(?:clash|proxy) subscriptions?\b/gu, " 机场 "],
  [/(?:商用|商业|商务)\s*vpn|\bcommercial\s+vpn\b/gu, " vpn "],
  [/\b(?:vcc|virtual (?:credit |payment )?cards?)\b|虚拟(?:信用|支付|借记)?卡/gu, " 虚拟信用卡 "],
  [/\bu\s*卡|\busdt\s*卡|稳定币(?:支付)?卡|\bstablecoin cards?\b/gu, " u卡 "],
  [/国际汇款|跨境汇款|\bcross[ -]border payments?\b/gu, " 跨境支付 "],
  [/轻量(?:云服务器|云主机|云)|云(?:服务器|主机)|虚拟专用服务器|\b(?:virtual private server|cloud hosting)\b/gu, " vps "],
  [/(?:静态)?住宅\s*(?:ip|代理)|\bresidential prox(?:y|ies)\b/gu, " 住宅代理 "],
  [/代理\s*ip(?:\s*服务)?|\bproxy ip\b/gu, " 代理ip "],
] as const;

const extraCategoryTerms: Record<string, string> = {
  ai: "AI 服务",
  "ai-topup": "AI 代充与卡网",
  "ai-card": "AI 代充与卡网",
  airport: "机场与 VPN",
  vpn: "机场与 VPN",
  payments: "U 卡与支付",
  vps: "VPS 与云服务",
};

export function directoryCategoryTerms(category: string) {
  // The broader homepage navigation labels only apply when searched as a whole.
  return extraCategoryTerms[category] ?? "";
}

const queryFiller = /^(?:(?:请问|我想|想要|帮我|哪里|如何|怎样|怎么|哪些|有没有|能不能|搜索|查找|找一下|搜一下|看看|可以|能够|购买|查|搜|找|买|卖|看|给|个|一下)\s*)+|(?:(?:的)?(?:商家|店铺|网站|服务商|有哪些|多少钱|怎么样)|吗|呢)$/gu;
const periodTerms = /每\s*(?:百万|100\s*万|1\s*m)\s*(?:输入|输出)\s*(?:tokens?)?|(?<![a-z0-9])(?:(?:million|1\s*m)\s+(?:input|output)(?:\s+tokens?)?|(?:input|output)\s+(?:per\s+)?(?:million|1\s*m)(?:\s+tokens?)?)(?![a-z0-9])|半年(?:付|卡)?|月付|月卡|每月|年付|年卡|每年|周付|每周|季付|季卡|每季|\d+\s*(?:个?月|年|周|天)(?!\d)|\b(?:monthly|yearly|annual(?:ly)?|weekly|quarterly)\b/gu;
const currencies: Record<string, string> = {
  人民币: "CNY", 美元: "USD", 港币: "HKD", 港元: "HKD", 欧元: "EUR", 英镑: "GBP", 日元: "JPY",
  rmb: "CNY", cny: "CNY", usd: "USD", hkd: "HKD", eur: "EUR", gbp: "GBP", jpy: "JPY",
};
const currencyTerms = /人民币|美元|港币|港元|欧元|英镑|日元|\b(?:rmb|cny|usd|hkd|eur|gbp|jpy)\b/gu;
const tier = /^(?:plus|pro|max|go|free|basic|team|business|ultra|enterprise)$/;
const versionTerms = /(?<![a-z0-9])(?:gpt|glm|claude\s+(?:sonnet|opus|haiku)|deepseek|gemini|kimi|grok|minimax|qwen)[\s_\p{Pd}]*[vr]?\d+(?:\.\d+)*(?:[a-z])?(?![a-z0-9]|\.\d)|(?<![0-9.])[vr]?\d+\.\d+(?:\.\d+)*(?!\d|\.\d)/gu;
const tokens = /(?:api中转|u卡|代理ip)|[a-z0-9]+|\p{Script=Han}+/gu;
const subscriptionProducts="chatgpt|claude|gemini|grok|deepseek|cursor|perplexity|qwen|doubao|kimi|copilot|windsurf|suno|midjourney";
const subscriptionQuery=new RegExp(`^(${subscriptionProducts}|ai)(?: (plus|pro|max|go|team|business|ultra))?\\s*(?:的?\\s*(?:会员|订阅)|subscriptions?|memberships?)$`);
const subscriptionBrand=new RegExp(`(?<![a-z0-9])(?:${subscriptionProducts}|supergrok)(?![a-z0-9])`);
const paidPlan=/(?:会员|订阅|月卡|年卡|付费|订阅制|\b(?:plus|pro|max|go|team|business|ultra|supergrok|subscription|membership)\b)/;
const unrelatedPlan=/接码|每百万.{0,9}token|全?自动注册|api\s*(?:额度|中转|网关|充值)/;

function normalize(text: string) {
  let result = canonicalize(text).trim();
  for (const [pattern, replacement] of aliases) result = result.replace(pattern, replacement);
  return result
    .replace(/\b(chatgpt|claude|gemini|grok|cursor|perplexity)[\s_-]*(plus|pro|max|go|free|business|ultra)(?![a-z0-9])/gu, "$1 $2")
    .replace(/\b(gpt|glm|deepseek|gemini|kimi|grok|minimax|qwen)(?=[vr]?\d)/gu, "$1 ")
    .replace(/[^\p{L}\p{N}.]+/gu, " ").trim();
}

const key = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, "");
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function periodKey(text: string) {
  const value = text.toLowerCase().replace(/\s+/g, "");
  if (/(?:输入|input)/.test(value)) return "input-token";
  if (/(?:输出|output)/.test(value)) return "output-token";
  if (/^(?:周|周付|每周|weekly|1周|7天)$/.test(value)) return "周";
  if (/^(?:季|季付|季卡|每季|quarterly|3个?月)$/.test(value)) return "3个月";
  if (/^(?:半年(?:付|卡)?|6个?月)$/.test(value)) return "6个月";
  if (/^(?:年卡|12个?月|365天)$/.test(value)) return "年";
  if (/^(?:月卡|30天)$/.test(value)) return "月";
  return comparablePeriod(value.replace(/^(\d+)月$/, "$1个月")).toLowerCase();
}

function near(a: string, b: string) {
  if (Math.min(a.length,b.length)<4 || Math.abs(a.length-b.length)>1 || !/^[a-z]+$/.test(a+b)) return false;
  let i=0;
  while (i<a.length && a[i]===b[i]) i++;
  if (a.length===b.length) {
    return a.slice(i+1)===b.slice(i+1) || (a[i]===b[i+1] && a[i+1]===b[i] && a.slice(i+2)===b.slice(i+2));
  }
  return a.length>b.length ? a.slice(i+1)===b.slice(i) : b.slice(i+1)===a.slice(i);
}

export function directorySearch(request: string, parseQuoteFilters=true) {
  const original=canonicalize(request.trim().slice(0, MAX_QUERY_LENGTH));
  const containsUrl=/^(?:https?:\/\/|www\.)|^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/:?#]|$)/i.test(original);
  const periods = new Set<string>();
  const currency = new Set<string>();
  const text = containsUrl || !parseQuoteFilters ? original : original
    .replace(periodTerms, (value) => { periods.add(periodKey(value)); return " "; })
    .replace(currencyTerms, (value) => { currency.add(currencies[value]); return " "; });
  const stripped = containsUrl ? text : text.trim().replace(queryFiller, "").trim();
  const normalizedQuery = normalize(stripped);
  const subscription = !containsUrl&&parseQuoteFilters ? subscriptionQuery.exec(normalizedQuery) : null;
  const normalized = subscription ? [subscription[1]==="ai"?"":subscription[1],subscription[2]??""].join(" ").trim() : normalizedQuery;
  const phrase = key(normalized);
  const versions: RegExp[] = [];
  const words = normalized.replace(versionTerms,(version)=>{
    const pattern=version.replace(/[ .]/g, (separator)=>separator==="."?"\\.":"[ ]*");
    versions.push(new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9]|\\.\\d)`,"u"));
    return " ";
  }).match(tokens) ?? [];
  const terms = [...new Set(words)].map((word)=>({
    word,
    boundary:tier.test(word)||/^[a-z]{1,2}$/.test(word)?new RegExp(`(?<![a-z0-9])${escapeRegex(word)}(?![a-z0-9])`,"u"):null,
  }));
  const hasQuoteFilter = periods.size>0 || currency.size>0 || subscription!==null;
  const structured = versions.length>0 || terms.some(({word})=>tier.test(word)||word==="接码");
  const urlKey = (text:string) => text.replace(/^https?:\/\/(?:www\.)?|^www\./, "").replace(/\/$/, "");
  const literal=key(original);
  const url=containsUrl?urlKey(original):"";
  const literalMatch=(text:string)=>!!literal && key(canonicalize(text))===literal;

  function scoreField(field: string, fuzzy: boolean) {
    if (containsUrl) {
      const target=urlKey(canonicalize(field));
      return target===url?12:target.startsWith(url)&&/[/:?#]/.test(target[url.length]??"")?8:0;
    }
    if (fuzzy&&!structured&&literalMatch(field)) return 12;
    const normalizedField = normalize(field);
    const hay = key(normalizedField);
    if (!hay || !phrase) return 0;
    if (versions.some((version)=>!version.test(normalizedField)) ||
        terms.some(({word,boundary})=>boundary?!boundary.test(normalizedField):!hay.includes(word))) {
      return fuzzy&&!structured&&near(hay,phrase)?5:0;
    }
    if (hay===phrase) return 12;
    if (hay.includes(phrase)) return 8;
    return 6;
  }

  function score(fields: Field[]) {
    return fields.reduce((best,{text,weight})=>Math.max(best,weight*scoreField(text,weight>=8)),0);
  }

  return {
    searchable:!!phrase||hasQuoteFilter,
    hasQuoteFilter,
    structured,
    containsUrl,
    literalMatch,
    score,
    matchesCategory: (label:string) => !!label && !structured && phrase===key(normalize(label)),
    quoteScore(title: string, quote: Pick<Price,"period"|"currency">, category: boolean) {
      if (periods.size>0 && (periods.size!==1 || !periods.has(periodKey(quote.period)))) return 0;
      if (currency.size>0 && (currency.size!==1 || !currency.has(quote.currency.toUpperCase()))) return 0;
      if (subscription) {
        if (!category) return 0;
        const normalizedTitle=normalize(title);
        if (!subscriptionBrand.test(normalizedTitle) || !paidPlan.test(normalizedTitle) || unrelatedPlan.test(normalizedTitle)) return 0;
      }
      return phrase ? scoreField(title,false) : hasQuoteFilter ? 6 : 0;
    },
  };
}
