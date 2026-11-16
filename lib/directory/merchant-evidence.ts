import { createHash } from "node:crypto";
import { assessMerchant,cleanTitle } from "./discovery-rules";
import { parseMerchantMetadata } from "./discovery-providers";
import { evidenceTerms } from "./merchant-queries";
import { pipelines,type Pipeline } from "./taxonomy";
import { websiteUrl } from "./validation";

const platforms=/官方文档|比较及推荐|站点合集|博客文章|指南|测评|百科|笔记|决策室|工具箱|教程|机场榜|比价|价格对比|价格查询工具|排行榜|站长网|导航|资源网|机场博客|卡网大全|affiliate disclosure|price comparison|directory|benchmarks|latest reviews|\bwiki\b|best.{1,28}(providers|services|vpns)|服务商列表|新闻专栏|proxy lists? by countr/i;
const commercial=/套餐|月付|购买|续费|下单|开卡|手续费|产品定价|计费|控制台|购买订阅|pricing|checkout|order now|start free|plans|monthly|buy now|apply now|available locations|payment fee/i;
const productLink=/(?:^|\/)(?:pricing|plans?|products?|store|shop|cart(?:\.php)?|checkout|billing|order|signup|register|clientarea|product-list|console|dashboard)(?:[/.?]|$)/i;
const proxy=/住宅代理|数据中心代理|静态住宅|\bsocks5\b|residential prox(?:y|ies)|datacenter prox(?:y|ies)/i;
const aliasesByPipeline:Record<Pipeline,RegExp>={
  "ai-retail":/(ChatGPT|Claude|Gemini|Grok|Perplexity|Cursor|Windsurf|Midjourney)/gi,
  connections:/(Clash|Shadowsocks|Hysteria2|V2Ray|Trojan|WireGuard|SOCKS5|IPLC|IEPL)/gi,
  "ai-relay":/(OpenAI|Claude|Gemini|DeepSeek|Mistral|Llama|Qwen)/gi,
  payments:/(USDT|USDC|Mastercard|Visa|SWIFT|SEPA)/gi,
  vps:/(KVM|NVMe|裸金属|云主机|独立服务器|住宅 IP|dedicated server|residential IP|AMD EPYC)/gi,
};
const categoryProducts:Record<string,string>={"ai-topup":"AI 会员代充", "ai-card":"AI 会员卡密或账号商品", "ai-relay":"模型接口服务",
  airport:"节点订阅服务",vpn:"商业 VPN 服务","proxy-services":"代理 IP 服务", "u-card":"稳定币相关支付卡",
  "virtual-card":"虚拟支付卡", "payment-accounts":"跨境支付或汇款服务", "subscription-payment":"订阅支付服务",vps:"虚拟主机或服务器产品",residential:"住宅 IP 主机服务"};

export type MerchantPrice={product:string;amount:number;currency:string;period:string};
export type MerchantProof={version:2;url:string;status:number;root:string;name:string;aliases:string[];summary:string;category:string;pipeline:Pipeline;lang:string;
  identity:string;excerpt:string;terms:string[];tags:string[];payments:string;contact:string;refund:string;prices:MerchantPrice[]};
export const merchantNameKey=(value:string)=>value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");

export function structuredObjects(html:string) {
  const objects:Record<string,unknown>[]=[];
  function descend(value:unknown,depth:number) {
    if (!value || depth>4 || objects.length>=40) return;
    if (Array.isArray(value)) { for (const node of value.slice(0,15)) descend(node,depth+1);return; }
    if (typeof value!=="object") return;
    const row=value as Record<string,unknown>;
    objects.push(row);
    descend(row["@graph"],depth+1);
  }
  for (const node of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { descend(JSON.parse(node[1]),0); } catch { /* Invalid embedded metadata is optional. */ }
  }
  return objects;
}

function links(html:string,url:string) {
  const origin=websiteUrl(url).registrable;
  const found:{url:string;label:string}[]=[];
  for (const [,href,content] of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'<>]{1,1200})["'][^>]*>([\s\S]{0,500}?)<\/a>/gi)) {
    try {
      const target=websiteUrl(new URL(href.replace(/&amp;/g,"&"),url).href);
      const page=new URL(target.url);page.search="";
      if (target.registrable===origin) found.push({url:page.href,label:cleanTitle(content)});
    } catch { /* Ignore links that are not on a public HTTP website. */ }
  }
  return found;
}

function priceFacts(items:Record<string,unknown>[]) {
  const prices:MerchantPrice[]=[];
  for (const item of items) {
    if (!/^(?:Product|Service)$/i.test(String(item["@type"]))||typeof item.name!=="string") continue;
    const offers:unknown[]=Array.isArray(item.offers)?item.offers:[item.offers];
    for (const itemOffer of offers.slice(0,8)) {
      if (!itemOffer||typeof itemOffer!=="object") continue;
      const offer=itemOffer as Record<string,unknown>;
      if (offer["@type"]!=="Offer") continue;
      const spec=offer.priceSpecification&&typeof offer.priceSpecification==="object"?offer.priceSpecification as Record<string,unknown>:offer;
      const price=spec.price??offer.price;
      const currency=String(spec.priceCurrency??offer.priceCurrency??"").toUpperCase();
      if (!/^\d{1,8}(?:\.\d{1,4})?$/.test(String(price))||!/^([A-Z]{3}|USDT|USDC)$/.test(currency)) continue;
      const period=String(spec.billingDuration??offer.billingDuration??"");
      if (prices.length<10) prices.push({product:cleanTitle(item.name).slice(0,140),amount:Number(price),currency,period:/^P\d+[DWMY]$/.test(period)?period:""});
    }
  }
  return prices;
}

export function merchantProof(pipeline:Pipeline,page:{body:string;url:string;status:number}):MerchantProof|null {
  const {body,url}=page;
  const meta=parseMerchantMetadata(body);
  const title=cleanTitle(meta.title);
  const pathname=new URL(url).pathname;
  if (!title||platforms.test(title)||/\/(?:blogs?|guides?|how-to|news|idcnews|articles?|review|reviews|posts?|forum|thread|rankings?|recommend|wiki|docs?|getting-started)\//i.test(pathname)) return null;
  const structured=structuredObjects(body);
  const identity=structured.find(row=>/^(?:Organization|LocalBusiness|Store|OnlineStore|WebSite)$/i.test(String(row["@type"])) && typeof row.name==="string");
  const heading=cleanTitle(/<h1\b[^>]*>([\s\S]{1,360}?)<\/h1>/i.exec(body)?.[1]??"");
  const bodyText=cleanTitle(body.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi," ").replace(/<[^>]+>/g," ")).slice(0,15_000);
  if (/商品与交易由第三方商家负责|本文含推广链接|商家收录不代表平台担保|比价工具站|第三方报价对比|一款基于php\d*开发的.*发卡系统/i.test(`${title} ${meta.description}`)) return null;
  if (!commercial.test(`${title} ${meta.description} ${heading} ${bodyText.slice(0,3000)}`)) return null;
  const brand=cleanTitle(meta.siteName??(identity?.name as string|undefined)??"").slice(0,100);
  const sameSite=links(body,url);
  const prices=priceFacts(structured);
  if (platforms.test(brand)||(!prices.length&&!productLink.test(pathname)&&!sameSite.some(link=>productLink.test(new URL(link.url).pathname)))) return null;
  const verifiedShelf=bodyText.slice(0,4200);
  const modelsOnShelf=Array.from(verifiedShelf.matchAll(aliasesByPipeline["ai-retail"]),match=>match[0].toLowerCase());
  const shelfMentions=pipeline==="ai-retail"&&new Set(modelsOnShelf).size>=2&&/卡密|卡网|自动发货|成品号|代充/.test(verifiedShelf)
    ?` ${[...new Set(modelsOnShelf)].join(" ")} ${verifiedShelf.match(/卡密|卡网|自动发货|成品号|代充/)?.[0]} 套餐`:"";
  const description=`${meta.description} ${heading}${shelfMentions}`;
  const emphasis=/\bvps\b|云服务器|云主机/i.test(title)&&/住宅\s*IP|residential IP/i.test(title)?"vps":pipeline;
  const order=[emphasis,...(Object.keys(pipelines) as Pipeline[]).filter(other=>other!==emphasis)] as Pipeline[];
  for (const kind of order) {
    const assessment=assessMerchant(kind,{...meta,siteName:brand||undefined,description});
    const proxyPage=kind==="connections"&&proxy.test(`${title} ${description}`);
    const serverPage=kind==="vps"&&/云主机|dedicated servers?|裸金属|独立服务器/.test(`${title} ${description}`);
    if (!assessment.accepted&&!proxyPage&&!serverPage) continue;
    const name=cleanTitle(assessment.name??(brand||title.split(/\s+[|–—-]\s+|[｜·]/).at(-1)||title));
    if (!name||name.length>64||platforms.test(name)||name.toLowerCase()===new URL(url).hostname.toLowerCase() ||
      /^(?:best|top|affordable|buy|cheap)\b|^(?:全球)?(?:最佳|低价|最便宜|购买)|[?？]|价格是多少/i.test(name)) continue;
    const category=proxyPage?"proxy-services":kind==="vps"&&/住宅\s*IP|residential IP/i.test(`${title} ${description}`)?"residential":assessment.category??"vps";
    const products=[...new Set(Array.from(`${title} ${description} ${bodyText.slice(0,4000)}`.matchAll(aliasesByPipeline[kind]),match=>match[0]).map(text=>text.toUpperCase()))].slice(0,8);
    const paymentTokens=[...new Set((`${description} ${bodyText.slice(0,6000)}`.match(/支付宝|微信支付|PayPal|Alipay|WeChat Pay/gi)??[]))];
    const aliases=typeof identity?.alternateName==="string"?[cleanTitle(identity.alternateName).slice(0,90)]:[];
    return {version:2,url,status:page.status,root:new URL(url).origin+"/",name,aliases,category,pipeline:kind,
      lang:assessment.language??meta.language??"",summary:`官网公开页面列有${categoryProducts[category]??pipelines[kind].label}。`,
      identity:createHash("sha256").update(merchantNameKey(`${title} ${meta.description}`)).digest("hex"),
      excerpt:[title,meta.description].filter(Boolean).join(" · ").slice(0,260),
      terms:evidenceTerms(kind,`${title} ${description} ${bodyText}`),tags:[categoryProducts[category]??pipelines[kind].label,...products],
      payments:paymentTokens.join("、"),contact:sameSite.find(link=>/^(?:联系(?:我们)?|客服|Contact(?: Us)?|Support)$/i.test(link.label))?.url??"",
      refund:sameSite.find(link=>/退款政策|退费政策|refund policy/i.test(link.label))?.url??"",prices};
  }
  return null;
}
