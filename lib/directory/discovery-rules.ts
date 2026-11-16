import { websiteUrl } from "./validation";
import type { Pipeline } from "./taxonomy";

const phrases:Record<Pipeline,readonly string[]>={
  "ai-retail":["ChatGPT Plus 代充","ChatGPT Pro 充值","Claude Pro 代充","Claude Max 代充","Gemini 订阅代充","Grok 会员代充","Cursor 订阅","Codex 会员","AI 会员卡密","AI 会员发卡","AI 共享车位","AI 成品号","AI 卡网","AI 订阅商城","数字商品自动发卡","AI subscription reseller"],
  connections:["机场订阅","机场加速","机场导航","Clash 订阅服务","V2Ray 机场","Trojan 机场","Hysteria2 机场","专线机场","IEPL 机场","网络加速服务","VPN subscription provider","proxy subscription service"],
  "ai-relay":["AI API 中转","OpenAI API 中转","Claude API 中转","模型聚合","New API 站点","One API 站点","AI API relay","LLM API gateway"],
  payments:["U 卡 申请 官网","虚拟信用卡 发卡平台","跨境支付 商家","稳定币卡 产品","virtual card issuer","remittance provider"],
  vps:["VPS 云服务器 商家","虚拟服务器 主机托管","independent VPS hosting"],
};
export const searchQueries=(pipeline:Pipeline)=>phrases[pipeline].flatMap(phrase=>{
  const chinese=/\p{Script=Han}/u.test(phrase);
  return [phrase,`"${phrase}" ${chinese?"套餐 官网":"plans pricing"}`].map(query=>({query,lang:chinese?"zh-hans":"en"}));
});

const commonPlatforms=new Set(["google.com","bing.com","baidu.com","reddit.com","youtube.com","wikipedia.org","github.com","t.me","zhihu.com","bilibili.com","qq.com","taobao.com","openai.com","anthropic.com","cloudflare.com","douyin.com"]);
const directories=new Set(["aiprice.club","aitest123.com","jiasu.wiki","aibibi.app","apiranking.com","jichangcloud.blog","fanqiangdaren.com","openprice.cc","aipricegood.com","aisubhub.top","jingxialai.com","tiziyun.co","jichangyyds.net",
  "aiapiprice.com","aipickguides.com","aipricex.com","priceai.cc","similarlabs.com","csdn.net","gitee.com","kamacoder.com"]);
const groupSignals:Record<Pipeline,readonly RegExp[]>={
  "ai-retail":[/chatgpt|claude|gemini|grok|codex|cursor|midjourney/i,/代充|充值|卡密|卡网|发卡|成品号|共享席位|resell|recharge|voucher/i],
  connections:[/机场|vpn|wireguard|clash|hysteria|trojan|节点订阅|proxy subscription/i,/套餐|订阅|计费|月付|客户端|pricing|plans?|subscription|download/i],
  "ai-relay":[/\bapi\b|模型网关|gateway/i,/中转|模型聚合|模型接入|大模型|llm|relay|unified|one api/i],
  payments:[/虚拟卡|信用卡|稳定币|跨境|virtual card|stablecoin|remittance/i,/发卡|支付|收款|付款|payment|issuing|wallet|transfer/i],
  vps:[/vps|云服务器|virtual server/i,/托管|定价|月付|套餐|hosting|pricing| plans?/i],
};
const exclusions=/本站(?:不销售|不参与交易)|仅提供导航|仅供参考.*不销售|订阅比价|比价平台|导航目录|机场推荐与评测|affiliate disclosure|(?:provider|merchant) directory|an independent directory|域名出售|domain (?:is )?for sale|parked domain/i;
const plausiblePage=/套餐|价格|订阅|商品|订单|帮助中心|发货|售后|产品|服务|pricing|checkout|subscription|plans?|shop|store|support|billing/i;
export const cleanTitle=(text:string)=>text.replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim();

export function leadUrl(value:string) {
  const parsed=websiteUrl(value);
  const url=new URL(parsed.url);
  url.search="";
  if (commonPlatforms.has(parsed.registrable)||directories.has(parsed.registrable)) throw new Error("平台、目录或非目标服务商");
  if (/\.(?:pdf|zip|exe|jpg|png|docx?|apk|m3u)$/i.test(url.pathname)||/\/(?:cart|checkout|aff(?:iliate)?|invite|ref|auth|login|register|signup|api|panel|sub|subscribe|subscription|token|download|sitemap)(?:[/.]|$)/i.test(url.pathname)) {
    throw new Error("跳转、下载、账户或非公开内容路径");
  }
  return {...parsed,url:url.href,homepage:url.origin+"/"};
}

export function merchantSearchLead(value:string) {
  const url=new URL(value);
  const rootOnly=/^\/(?:auth\/)?(?:login|register|sign-in|signin|signup)(?:\.html|\/)?$/i.test(url.pathname);
  return {target:leadUrl(rootOnly?`${url.origin}/`:value),rootOnly};
}

export function assessMerchant(pipeline:Pipeline,meta:{title?:string;description?:string;language?:string;siteName?:string}) {
  const title=cleanTitle(meta.title??"");
  const description=cleanTitle(meta.description??"");
  const combined=`${title} ${description}`;
  if (!title || exclusions.test(combined) || /^(?:Home|首页|登录|Sign in|线路检测|New API|One API|404|Welcome)$/i.test(title)) {
    return {accepted:false,reason:"商家标识不足，或页面属于导航、广告及模板。"};
  }
  if (!plausiblePage.test(combined)||!groupSignals[pipeline].every(signal=>signal.test(combined))) return {accepted:false,reason:"未同时取得商家业务和服务形态证据。"};
  const name=(cleanTitle(meta.siteName??"")||title.split(/\s+[|–—-]\s+|[｜·]/)[0].trim()).slice(0,100);
  if (name.length<2) return {accepted:false,reason:"缺少可识别的品牌。"};
  const category=pipeline==="ai-retail"?/发卡|卡网|卡密|成品号|商城|voucher|store/i.test(combined)?"ai-card":"ai-topup":
    pipeline==="connections"?/机场|节点订阅|clash|hysteria/i.test(combined)?"airport":"vpn":
    pipeline==="payments"?/稳定币|\bu\s*卡|stablecoin/i.test(combined)?"u-card":/虚拟卡|virtual card/i.test(combined)?"virtual-card":"payment-accounts":
    pipeline==="ai-relay"?"ai-relay":"vps";
  return {accepted:true as const,name,category,language:meta.language??(/\p{Script=Han}/u.test(combined)?"zh":/[a-z]{4}/i.test(combined)?"en":"")};
}
