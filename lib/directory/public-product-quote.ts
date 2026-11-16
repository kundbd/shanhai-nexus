import { merchantNameKey,structuredObjects } from "./merchant-evidence";
import { isStorefrontPlatform } from "./storefront-identity";
import type { StorefrontObservation } from "./storefront-import";
import { websiteUrl } from "./validation";

type JsonObject=Record<string,unknown>;
const object=(value:unknown):JsonObject|undefined=>value&&typeof value==="object"&&!Array.isArray(value)?value as JsonObject:undefined;
const string=(value:unknown)=>typeof value==="string"?value.trim():"";
const brands=/ChatGPT|GPT|Claude|Gemini|Grok|Cursor|Perplexity|Windsurf|Codex|Kiro|Google AI/i;
const excluded=/补差价|补款|押金|咨询客服|接码|验证服务|退款专用|白号|免费账号|API.{0,5}(?:余额|中转|额度)/i;

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
  if (page.search||isStorefrontPlatform(domain)) return;
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
      if(sellerUrl&&(!productHref(sellerUrl,url)||new URL(sellerUrl,url).origin!==page.origin))continue;
      const name=string(seller?.name)||metaSeller||domain;
      if(name.length>100||(metaSeller&&merchantNameKey(metaSeller)!==merchantNameKey(name)))continue;
      const variant=string(offer.name);
      const plan=variant&&merchantNameKey(variant)!==merchantNameKey(productName)?`${productName} · ${variant}`:productName;
      if(plan.length>150||excluded.test(plan))continue;
      const price=String(offer.price??"");
      if(!/^\d{1,6}(?:\.\d{1,2})?$/.test(price)||Number(price)<=0)continue;
      const periods=plan.replace(/(?:质保|保订阅|保修)\s*[0-9一二三十]+\s*(?:个?月|年|天)/gi,"");
      const period=/年卡|年付|1\s*年/.test(periods)?"1年":/月卡|月付|1\s*个月|\b30\s*天/.test(periods)?"1个月":"周期未注明";
      const cnyMinor=Math.round(Number(price)*100);
      const availability=string(offer.availability);
      const expired=typeof offer.priceValidUntil==="string"&&offer.priceValidUntil.slice(0,10)<observedAt.slice(0,10);
      const notes=[expired?"页面标价已过有效期。":"",/Discontinued/i.test(availability)?"页面标记商品已停售。":
        /OutOfStock|SoldOut/i.test(availability)?"观测时缺货。":/PreOrder/i.test(availability)?"页面标记为预售。":""].join("");
      const prior=offers.get(plan);
      if(prior&&prior.offer.cnyMinor!==cnyMinor)disagreements.add(plan);
      offers.set(plan,{offer:{plan,cnyMinor,period,...(notes?{notes}:{})},seller:name});
    }
  }
  const records=[...offers.values()].filter(({offer})=>!disagreements.has(offer.plan));
  const names=new Set(records.map(record=>merchantNameKey(record.seller)));
  if (names.size!==1) return;
  return {name:records[0].seller,website:page.origin+"/",sourceUrl:url,observedAt,discoveryUrl,
    category:records.some(({offer})=>/成品|共享|独享|席位|车位|卡密/i.test(offer.plan))?"ai-card":"ai-topup",
    offers:records.slice(0,20).map(record=>record.offer)};
}
