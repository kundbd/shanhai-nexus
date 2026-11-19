import { merchantNameKey,structuredObjects } from "./merchant-evidence";
import { isStorefrontPlatform,storefrontIdentity } from "./storefront-identity";
import type { StorefrontObservation } from "./storefront-import";
import { websiteUrl } from "./validation";

type JsonObject=Record<string,unknown>;
const object=(value:unknown):JsonObject|undefined=>value&&typeof value==="object"&&!Array.isArray(value)?value as JsonObject:undefined;
const string=(value:unknown)=>typeof value==="string"?value.trim():"";
const brands=/ChatGPT|GPT|Claude|Gemini|Grok|Cursor|Perplexity|Windsurf|Codex|Kiro|Google AI/i;
const excluded=/补差价|补款|押金|咨询客服|接码|验证服务|退款专用|白号|免费账号|API.{0,5}(?:余额|中转|额度)/i;
const retailForm=/代充|直充|续费|卡密|月卡|年卡|成品号|账号|订阅|会员|兑换码|gift card|subscription/i;
const unavailable=/缺货|售罄|停售|已下架|预售|暂不可购买|商品不存在|out of stock|sold out/i;

function meta(html:string,key:string) {
  for(const [tag] of html.matchAll(/<meta\b[^>]{1,1800}>/gi)) {
    const fields=Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map((match)=>[match[1].toLowerCase(),match[2]??match[3]]));
    if(fields.property===key||fields.name===key) return (fields.content??"").replace(/&amp;/g,"&").trim();
  }
  return "";
}

function productHref(raw:string, base:string) {
  try {
    const url=new URL(websiteUrl(new URL(raw,base).href).url);
    if(url.search)return "";
    return url.origin+url.pathname.replace(/\/$/,"");
  } catch { return ""; }
}

export function publicProductObservation(html:string,productUrl:string,observedAt:string,discoveryUrl?:string):StorefrontObservation|undefined {
  const {url,domain}=websiteUrl(productUrl);
  const page=new URL(url);
  const storefront=storefrontIdentity(url);
  if (page.search||(isStorefrontPlatform(domain)&&!storefront)) return;
  const expected=productHref(url,url);
  const offers=new Map<string,{offer:StorefrontObservation["offers"][number];seller:string}>();
  const disagreements=new Set<string>();
  const metaSeller=meta(html,"og:site_name");
  for (const product of structuredObjects(html)) {
    const productName=string(product.name);
    if(product["@type"]!=="Product"||!productName||!brands.test(productName)||excluded.test(productName))continue;
    const list=Array.isArray(product.offers)?product.offers:[product.offers];
    for(const item of list) {
      const offer=object(item);
      if(!offer||offer["@type"]!=="Offer"||offer.priceCurrency!=="CNY")continue;
      const destination=string(offer.url)||string(product.url);
      if(destination&&productHref(destination,url)!==expected)continue;
      const seller=object(offer.seller)??object(product.seller);
      const sellerUrl=string(seller?.url);
      if(sellerUrl) {
        const sellerHref=productHref(sellerUrl,url);
        if (!sellerHref||(storefront?storefrontIdentity(sellerHref)?.key!==storefront.key:new URL(sellerHref).origin!==page.origin)) continue;
      }
      if (storefront&&!sellerUrl&&!metaSeller) continue;
      const name=string(seller?.name)||metaSeller||domain;
      if(name.length>100||(metaSeller&&merchantNameKey(metaSeller)!==merchantNameKey(name)))continue;
      const variant=string(offer.name);
      const plan=variant&&merchantNameKey(variant)!==merchantNameKey(productName)?`${productName} · ${variant}`:productName;
      if(plan.length>150||excluded.test(plan))continue;
      const price=String(offer.price??"");
      if(!/^\d{1,6}(?:\.\d{1,2})?$/.test(price)||Number(price)<=0)continue;
      const period=retailPeriod(plan);
      const cnyMinor=Math.round(Number(price)*100);
      const availability=string(offer.availability);
      const expired=typeof offer.priceValidUntil==="string"&&offer.priceValidUntil.slice(0,10)<observedAt.slice(0,10);
      const notes=[expired?"页面标价已过有效期。":"",/Discontinued/i.test(availability)?"页面标记商品已停售。":
        /OutOfStock|SoldOut/i.test(availability)?"观测时缺货。":/PreOrder/i.test(availability)?"页面标记为预售。":""].join("");
      const stock=notes?"unavailable":/(?:^|\/)(?:InStock|LimitedAvailability)$/i.test(availability)?"available":undefined;
      const prior=offers.get(plan);
      if(prior&&(prior.offer.cnyMinor!==cnyMinor||prior.offer.availability!==stock))disagreements.add(plan);
      offers.set(plan,{offer:{plan,cnyMinor,period,...(stock?{availability:stock}:{}),...(notes?{notes}:{})},seller:name});
    }
  }
  const records=[...offers.values()].filter(({offer})=>!disagreements.has(offer.plan));
  const names=new Set(records.map(record=>merchantNameKey(record.seller)));
  if (names.size!==1) return;
  return {name:records[0].seller,website:storefront?.url??page.origin+"/",sourceUrl:url,observedAt,discoveryUrl,
    category:records.some(({offer})=>/成品|共享|独享|席位|车位|卡密/i.test(offer.plan))?"ai-card":"ai-topup",
    offers:records.slice(0,20).map(record=>record.offer)};
}

export function retailPeriod(plan:string) {
  const text=plan.replace(/(?:质保|保订阅|保修)\s*[0-9一二三十]+\s*(?:个?月|年|天)/gi,"");
  const year=/年卡|年付|(?:^|\D)1\s*年|\b365\s*天/.test(text);
  const month=/月卡|月付|(?:^|\D)1\s*个月|\b30\s*天/.test(text);
  if (year===month) return "周期未注明";
  return year?"1年":"1个月";
}

// A visible price must sit in the same short product section as its title and purchase control.
export function publicShelfObservation(html:string,sourceUrl:string,observedAt:string,name:string,category:StorefrontObservation["category"]):StorefrontObservation|undefined {
  const page=new URL(sourceUrl);
  const storefront=storefrontIdentity(sourceUrl);
  if (page.search||isStorefrontPlatform(websiteUrl(sourceUrl).domain)&&!storefront) return;
  const cleaned=html.replace(/<(script|style|noscript|svg|template|footer|del|s|strike)\b[^>]*>[\s\S]*?<\/\1>/gi," ");
  const headings=[...cleaned.matchAll(/<h[1-6]\b[^>]*>([\s\S]{1,380}?)<\/h[1-6]>/gi)];
  const plain=(text:string)=>text.replace(/<[^>]*>/g," ").replace(/&(?:yen|#165|#xA5);/gi,"¥")
    .replace(/&(?:nbsp|amp|quot);/gi," ").replace(/\s+/g," ").trim();
  const mainland=/<html\b[^>]*\blang=["']zh(?:-CN|-Hans)["']/i.test(html);
  const offers=new Map<string,StorefrontObservation["offers"][number]>();
  const disputed=new Set<string>();
  for (const [index,heading] of headings.entries()) {
    const title=plain(heading[1]);
    if (title.length>130||!brands.test(title)||!retailForm.test(title)||excluded.test(title)) continue;
    const start=heading.index+heading[0].length;
    const sectionHtml=cleaned.slice(start,headings[index+1]?.index??cleaned.length);
    const section=plain(sectionHtml);
    if (!section||section.length>800||!/立即购买|加入购物车|自助下单|立即订阅|立即开通|buy now|add to cart/i.test(section)||
      /价格对比|参考价|预估价|售价面议|以结算页为准|满[减赠]|优惠券|低至|起售|折后|原价|其他商家/.test(section)) continue;
    const amounts=[...section.matchAll(/(?:(人民币|\bCNY\b|\bRMB\b)\s*[¥￥]?\s*|([¥￥])\s*)(\d{1,6}(?:\.\d{1,2})?)(?![\d.,])|(?<![\d.,])(\d{1,6}(?:\.\d{1,2})?)\s*元(?!素|气)/gi)];
    if (amounts.length!==1||/[€$]|(?:JPY|USD|EUR|HKD|TWD|NTD)\b|[日美港澳]元|新台币/i.test(section)) continue;
    const [match,explicit,symbol,prefixAmount,suffixAmount]=amounts[0];
    if (symbol&&!explicit&&!mainland&&!/人民币|\bCNY\b/i.test(section)) continue;
    if (/^\s*(?:起|约|[～~]|至|[-–—]\s*[¥￥]?\d)/.test(section.slice(amounts[0].index+match.length))) continue;
    const amount=prefixAmount??suffixAmount;
    const cnyMinor=Math.round(Number(amount)*100);
    if (cnyMinor<=0) continue;
    const period=retailPeriod(title);
    const previous=offers.get(title);
    if (previous&&previous.cnyMinor!==cnyMinor) disputed.add(title);
    const stock=section.match(unavailable)?.[0];
    const hasPurchaseControl=[...sectionHtml.matchAll(/<(a|button)\b([^>]*)>([\s\S]{1,300}?)<\/\1>/gi)].some(([,tag,attributes,label])=>
      !/\bdisabled\b|aria-disabled\s*=\s*["']?true|\bhidden\b/i.test(attributes)
      && (tag.toLowerCase()==="button"||/\bhref\s*=\s*["']?(?:\/[^/]|https?:\/\/)/i.test(attributes))
      && /立即购买|加入购物车|自助下单|立即订阅|立即开通|buy now|add to cart/i.test(plain(label)));
    const availability=stock?"unavailable":hasPurchaseControl?"available":undefined;
    if (previous && previous.availability!==availability) disputed.add(title);
    offers.set(title,{plan:title,cnyMinor,period,productTitle:title,...(availability?{availability}:{}),
      ...(stock?{notes:`公开页标记为${stock}。`}:{})});
  }
  const visible=[...offers.values()].filter(row=>!disputed.has(row.plan)).slice(0,20);
  return visible.length?{name,website:storefront?.url??page.origin+"/",sourceUrl,observedAt,category,offers:visible}:undefined;
}
