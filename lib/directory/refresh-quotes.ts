import { currencyDigits } from "./exchange-rates";
import { merchantNameKey,structuredObjects } from "./merchant-evidence";
import { comparablePeriod,unspecifiedRegion,type PublishedQuote } from "./price-board";

const money=/^\d{1,9}(?:\.\d{1,4})?$/;
type QuoteIdentity=Pick<PublishedQuote,"plan"|"period"|"region"|"currency">;

function amountMinor(raw:unknown,currency:string) {
  const value=String(raw??"").trim();
  if (!money.test(value)) return;
  const digits=currencyDigits(currency);
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

export function verifiedQuoteAmount(html:string,url:string,quote:QuoteIdentity,date:string) {
  const key=merchantNameKey(quote.plan);
  const amounts:unknown[]=exactPageAmounts(html,new URL(url),quote);
  for (const product of structuredObjects(html)) {
    if (!/^(Product|Service)$/i.test(String(product["@type"]))||typeof product.name!=="string"||merchantNameKey(product.name)!==key) continue;
    const offers=Array.isArray(product.offers)?product.offers:[product.offers];
    for (const entry of offers.slice(0,24)) {
      if (!entry||typeof entry!=="object") continue;
      const offer=entry as Record<string,unknown>;
      if (offer["@type"]!=="Offer"||/OutOfStock|Discontinued|SoldOut/i.test(String(offer.availability??""))) continue;
      if (typeof offer.priceValidUntil==="string"&&offer.priceValidUntil.slice(0,10)<date.slice(0,10)) continue;
      const spec=offer.priceSpecification&&typeof offer.priceSpecification==="object"?offer.priceSpecification as Record<string,unknown>:offer;
      const currency=spec.priceCurrency??offer.priceCurrency;
      const period=String(spec.billingDuration??spec.unitText??offer.billingDuration??"");
      const region=offer.eligibleRegion;
      const sameRegion=region==null?unspecifiedRegion(quote.region):typeof region==="string"&&region.trim()===quote.region.trim();
      if (currency===quote.currency&&period&&comparablePeriod(period)===comparablePeriod(quote.period)&&sameRegion) amounts.push(spec.price??offer.price);
    }
  }
  const values=new Set(amounts.flatMap(raw=>{ const value=amountMinor(raw,quote.currency); return value===undefined?[]:[value]; }));
  return values.size===1?[...values][0]:undefined;
}
