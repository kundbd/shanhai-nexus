import { currencyDigits } from "./exchange-rates";
import { merchantNameKey,structuredObjects } from "./merchant-evidence";
import { comparablePeriod,unspecifiedRegion,type PublishedQuote } from "./price-board";
import { isRelayTokenPeriod,relayRateRegion } from "./relay-quote-units";
import { websiteUrl } from "./validation";

const money=/^\d{1,9}(?:\.\d{1,6})?$/;
type QuoteIdentity=Pick<PublishedQuote,"plan"|"period"|"region"|"currency"|"amount_scale">;
type StructuredQuote={plan:string;amount:string;currency:string;period:string;region?:string};

export function amountMinor(raw:unknown,currency:string,scale?:number|null) {
  const value=String(raw??"").trim();
  if (!money.test(value)) return;
  const digits=scale??currencyDigits(currency);
  const [whole,fraction=""]=value.split(".");
  if (/[^0]/.test(fraction.slice(digits))) return;
  const result=Number(whole)*10**digits+Number(fraction.slice(0,digits).padEnd(digits,"0"));
  return Number.isSafeInteger(result)?result:undefined;
}

function plainText(html:string) {
  return html.replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi," ")
    .replace(/<[^>]*>/g," ").replace(/&(?:nbsp|#160);/gi," ").replace(/&(?:dollar|#36);/gi,"$").replace(/\s+/g," ");
}

function planSection(html:string,plan:string) {
  const headings=[...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]{1,400}?)<\/h[1-6]>/gi)];
  const key=merchantNameKey(plan);
  const index=headings.findIndex(match=>merchantNameKey(plainText(match[1]))===key);
  if (index<0) return "";
  const start=headings[index].index!+headings[index][0].length;
  return plainText(html.slice(start,Math.min(headings[index+1]?.index??html.length,start+8_000)));
}

function exactPageAmounts(html:string,url:URL,quote:QuoteIdentity) {
  const period=comparablePeriod(quote.period);
  if (quote.currency!=="USD") return [];
  const path=url.pathname.replace(/\/$/,"");
  const host=url.hostname.replace(/^www\./,"");
  if (host==="help.openai.com"&&/^\/en\/articles\/6950777(?:-|$)/.test(path)&&quote.plan==="Plus"&&period==="月"&&unspecifiedRegion(quote.region)) {
    // A standalone price line on the approved Plus help article, separate from other plans.
    return [...plainText(html).matchAll(/\bPrice\s*:\s*\$\s*(\d+(?:\.\d+)?)\s*\/\s*month\b/gi)].map(match=>match[1]);
  }
  if (host==="claude.com"&&path==="/pricing"&&/^Pro (?:月|年)付$/.test(quote.plan)&&unspecifiedRegion(quote.region)) {
    const text=planSection(html,"Pro");
    const pattern=period==="年"?/\bannual subscription discount\s*\(\s*\$\s*(\d+(?:\.\d+)?)\s+billed up front\b/gi:
      /\$\s*(\d+(?:\.\d+)?)\s+if\s+billed monthly\b/gi;
    return [...text.matchAll(pattern)].map(match=>match[1]);
  }
  if (host==="nixihost.com"&&path==="/hosting/vps"&&period==="月"&&quote.region==="美国得州休斯敦"&&/\bHouston,?\s*(?:TX|Texas)\b/i.test(plainText(html))) {
    return [...planSection(html,quote.plan).matchAll(/\$\s*(\d+(?:\.\d+)?)\s*\/\s*mo(?:nth)?\b/gi)].map(match=>match[1]);
  }
  if (host==="net-shuttle.com"&&path==="/pricing"&&quote.plan==="标准版"&&unspecifiedRegion(quote.region)&&
    /(?:页面价格以|價格以)\s*美元\s*[（(]\s*USD\s*[)）]/i.test(plainText(html))) {
    const matchers:Record<string,RegExp>={月:/\$\s*(\d+(?:\.\d+)?)\s*\/\s*月/g,季:/\$\s*(\d+(?:\.\d+)?)\s*\/\s*季/g,年:/\$\s*(\d+(?:\.\d+)?)\s*\/\s*年/g};
    const matcher=Object.hasOwn(matchers,period)?matchers[period]:undefined;
    if (matcher) return [...planSection(html,quote.plan).matchAll(matcher)].map(match=>match[1]);
  }
  return [];
}

export function structuredPublicQuotes(html:string,url:string,date:string) {
  const result:StructuredQuote[]=[];
  const domain=websiteUrl(url).registrable;
  const servesOwnSite=(value:unknown)=>{
    if (value==null||value==="") return true;
    try { return typeof value==="string"&&websiteUrl(new URL(value,url).href).registrable===domain; }
    catch { return false; }
  };
  for (const product of structuredObjects(html)) {
    if (!/^(Product|Service)$/i.test(String(product["@type"]))||typeof product.name!=="string"||
      !product.name.trim()||product.name.length>145||!servesOwnSite(product.url)) continue;
    const offers=Array.isArray(product.offers)?product.offers:[product.offers];
    for (const entry of offers.slice(0,24)) {
      if (!entry||typeof entry!=="object") continue;
      const offer=entry as Record<string,unknown>;
      if (offer["@type"]!=="Offer"||/OutOfStock|Discontinued|SoldOut|PreOrder/i.test(String(offer.availability??""))||!servesOwnSite(offer.url)) continue;
      if (typeof offer.priceValidUntil==="string"&&offer.priceValidUntil.slice(0,10)<date.slice(0,10)) continue;
      const spec=offer.priceSpecification&&typeof offer.priceSpecification==="object"?offer.priceSpecification as Record<string,unknown>:offer;
      const currency=spec.priceCurrency??offer.priceCurrency;
      const period=spec.billingDuration??spec.unitText??offer.billingDuration;
      const region=offer.eligibleRegion;
      const seller=offer.seller??product.seller;
      if (seller&&typeof seller==="object"&&!servesOwnSite((seller as {url?:unknown}).url)) continue;
      const amount=String(spec.price??offer.price??"").trim();
      if (typeof currency!=="string"||!/^[A-Z]{3}$/.test(currency)||typeof period!=="string"||!period.trim()||period.length>45||
        (region!=null&&(typeof region!=="string"||!region.trim()||region.length>80))||!money.test(amount)) continue;
      result.push({plan:product.name.trim(),currency,period:period.trim(),region:typeof region==="string"?region.trim():undefined,amount});
    }
  }
  return result;
}

export function verifiedQuoteAmount(html:string,url:string,quote:QuoteIdentity,date:string,structured=structuredPublicQuotes(html,url,date)) {
  const key=merchantNameKey(quote.plan);
  const amounts=[...exactPageAmounts(html,new URL(url),quote),...structured.filter(row=>
    merchantNameKey(row.plan)===key&&row.currency===quote.currency&&comparablePeriod(row.period)===comparablePeriod(quote.period)&&
    (row.region?row.region===quote.region.trim():unspecifiedRegion(quote.region)||
      isRelayTokenPeriod(quote.period)&&quote.region===relayRateRegion)).map(row=>row.amount)];
  const values=new Set(amounts.flatMap(raw=>{ const value=amountMinor(raw,quote.currency,quote.amount_scale); return value===undefined?[]:[value]; }));
  return values.size===1?[...values][0]:undefined;
}
