import { all, directory } from "./db";
import { exchangeRates,toCnyAmount } from "./exchange-rates";
import { aiSubscriptionTier,conflictsWithObservedAiTier } from "./ai-subscription-tier";
import { aiProducts,codexVerificationProduct,mentionedAiProducts,mentionsCodex,officialAiProduct } from "./ai-product";
import { isRelayTokenPeriod } from "./relay-quote-units";
import { relayModelKey } from "./relay-models";
import { publicPriceEvidence } from "./public-quote-policy";
import type { Price } from "./types";

export type PublishedQuote = Price & { site_slug:string; site_name:string; category_slug:string; category_label:string; source_kind:string };

export const priceRecordedTime=(column:string)=>`julianday(CASE WHEN length(${column})=10 THEN ${column} || 'T00:00:00+08:00' ELSE ${column} END)`;

function publishedQuotes(db:ReturnType<typeof directory>,includeStorefronts:boolean) {
  return all<PublishedQuote>(db,`WITH ranked AS (
    SELECT p.*,s.slug site_slug,s.name site_name,c.slug category_slug,c.label category_label,
      src.url source_url,src.title source_title,src.kind source_kind,
      row_number() OVER (PARTITION BY p.site_id,p.storefront_observed,p.reported_item_url,
        CASE WHEN p.reported_item_url IS NULL THEN p.plan END,
        CASE WHEN p.reported_item_url IS NULL THEN p.currency END,
        CASE WHEN p.reported_item_url IS NULL THEN p.period END,
        CASE WHEN p.reported_item_url IS NULL THEN p.region END,
        CASE WHEN p.storefront_observed=1 AND p.reported_item_url IS NULL THEN src.url END
        ORDER BY ${priceRecordedTime("p.recorded_at")} DESC,p.id DESC) position
    FROM price_records p JOIN sites s ON s.id=p.site_id JOIN categories c ON c.slug=s.category_slug
      JOIN sources src ON src.id=p.source_id
    WHERE p.publication='published' AND s.publication='published' AND s.lifecycle<>'closed'
    AND ${publicPriceEvidence}
    AND (p.storefront_observed=0 OR (?=1 AND s.category_slug IN ('ai-topup','ai-card')))
  ) SELECT * FROM ranked WHERE position=1 ORDER BY category_slug,site_id,id`,Number(includeStorefronts));
}

// The legacy HTML refresher interprets amounts in the currency's default minor unit.
export const currentPublicQuotes=(db=directory())=>publishedQuotes(db,false).filter(quote=>quote.amount_scale==null);

export function comparablePeriod(value:string) {
  const period=value.normalize("NFKC").trim();
  if (/^(?:月|月付|每月|1\s*个月|month(?:ly)?|mo|P1M)$/i.test(period)) return "月";
  if (/^(?:年|年付|每年|1\s*年|year(?:ly)?|annual(?:ly)?|P1Y)$/i.test(period)) return "年";
  return period;
}

export const unspecifiedRegion=(value:string)=>/^(?:官网未注明|地区未注明|(?:官方|官网)(?:人民(币)?|美元|欧元)?(?:报价|展示))$/.test(value.trim());

export const priceCategories={airport:"机场",vpn:"VPN",vps:"VPS",ai:"AI 订阅","ai-relay":"AI API 中转",payments:"U 卡与支付"} as const;
type PriceCategory=keyof typeof priceCategories;

export const featuredAiProducts=aiProducts.slice(0,5);
const aiQuoteCategories=new Set(["ai-subscriptions","ai-platforms","ai-topup","ai-card"]);
const paymentCategories=new Set(["u-card","virtual-card","payment-accounts","subscription-payment"]);

function quoteCategory(quote:PublishedQuote) {
  if (["airport","vpn","vps","ai-relay"].includes(quote.category_slug)) return {category:quote.category_slug as PriceCategory,product:null};
  if (paymentCategories.has(quote.category_slug)) return {category:"payments" as const,product:null};
  if (!aiQuoteCategories.has(quote.category_slug)) return;
  const official=quote.category_slug==="ai-subscriptions"?officialAiProduct(quote.site_slug):undefined;
  const product=quoteAiProduct(quote.plan,official);
  if (product) return {category:"ai" as const,product};
}

function quoteAiProduct(plan:string,official?:typeof aiProducts[number]) {
  if (plan===codexVerificationProduct) return codexVerificationProduct;
  const name=plan.normalize("NFKC");
  const mentioned=mentionedAiProducts(name);
  if (mentioned.length>1) return;
  if (official&&mentioned[0]&&official!==mentioned[0]) return;
  const codex=mentionsCodex(name);
  if (codex&&/(?:单次|一次性).{0,9}(?:接[码马]|短信验证|手机号验证)|\bcredits?\b|(?:购买|充值)\s*额度|(?:codex\s*\d+\s*额度)/i.test(name)) return;
  return mentioned[0]??official??(codex?"ChatGPT":undefined);
}

function boardPeriod(quote:Pick<Price,"period">,product:string|null) {
  const period=comparablePeriod(quote.period);
  if (!product) return period;
  if (/^30\s*天$/.test(period)) return "月";
  if (/^(?:12\s*个月|365\s*天)$/.test(period)) return "年";
  return period;
}

function conflictsWithStorefrontTitle(quote:Pick<Price,"storefront_observed"|"product_title">,product:string,tier:string,period:string) {
  if (!quote.storefront_observed||!quote.product_title) return false;
  const mentioned=mentionedAiProducts(quote.product_title.normalize("NFKC"));
  return mentioned.some(name=>name!==product)||conflictsWithObservedAiTier(product,tier,period,quote.product_title);
}

export function storefrontTierNeedsReview(quote:Pick<Price,"storefront_observed"|"product_title"|"plan"|"period"|"amount_minor">) {
  if (!quote.storefront_observed||!quote.product_title) return false;
  const product=quoteAiProduct(quote.plan);
  if (!product||product===codexVerificationProduct) return false;
  const period=boardPeriod(quote,product);
  const tier=aiSubscriptionTier(product,quote.plan,period,quote.amount_minor);
  return !!tier&&conflictsWithStorefrontTitle(quote,product,tier,period);
}

const unavailableQuote=/缺货|售罄|停售|过有效期|预售|异常低价/;
const partialProduct=/半成品|试用|体验(?:号|账号|版|套餐)|补差价|补款|押金|定金/;

export type PricedInCny=PublishedQuote & {cny_minor:number;cny_amount:number};
type QuoteGroup={key:string;category:PriceCategory;product:string|null;tier:string|null;period:string;region:string|null;subcategory:string|null;quotes:PricedInCny[];merchants:number};

export function publicPriceBoard(db=directory()) {
  const {day,byCurrency}=exchangeRates(db);
  const groups=new Map<string,QuoteGroup>();
  const relayModelNames=new Map<string,string>();
  let missingExchange=0;
  for (const quote of publishedQuotes(db,true)) {
    if (quote.storefront_observed&&(unavailableQuote.test(quote.notes)||partialProduct.test(quote.plan)||partialProduct.test(quote.product_title??""))) continue;
    const scope=quoteCategory(quote);
    if (!scope) continue;
    const period=boardPeriod(quote,scope.product);
    const verification=scope.product===codexVerificationProduct;
    if(verification&&(period!=="每次"||quote.amount_minor<=0))continue;
    const tier=scope.product&&!verification?aiSubscriptionTier(scope.product,quote.plan,period,quote.amount_minor):null;
    if (scope.product&&!verification&&!tier) continue;
    if (scope.product&&tier&&conflictsWithStorefrontTitle(quote,scope.product,tier,period)) continue;
    const cny=toCnyAmount(quote.amount_minor,quote.currency,byCurrency,quote.amount_scale??undefined);
    if (cny===undefined || !Number.isSafeInteger(Math.round(cny*100))) { missingExchange++; continue; }
    const region=scope.product?null:unspecifiedRegion(quote.region)||quote.region==="公开免费计划"?"报价地区未注明":quote.region.trim();
    let relayModel:string|null=null;
    if (scope.category==="ai-relay"&&isRelayTokenPeriod(period)) {
      const identity=relayModelKey(quote.plan);
      relayModel=relayModelNames.get(identity)??quote.plan;
      relayModelNames.set(identity,relayModel);
    }
    const subcategory=relayModel??(scope.category==="payments"?quote.category_label:null);
    const dimensions=[scope.category,null,period,region];
    if(subcategory) dimensions.push(relayModel??quote.category_slug);
    const key=scope.product?JSON.stringify([scope.category,scope.product,tier,period]):JSON.stringify(dimensions);
    const group=groups.get(key)??{key,...scope,tier:tier??null,period,region,subcategory,quotes:[],merchants:0};
    if (relayModel&&group.quotes.some(row=>row.site_id===quote.site_id&&row.source_url===quote.source_url&&
      row.currency===quote.currency&&row.amount_minor===quote.amount_minor&&row.amount_scale===quote.amount_scale)) continue;
    group.quotes.push({...quote,cny_minor:Math.round(cny*100),cny_amount:cny});
    groups.set(key,group);
  }
  const result=[...groups.values()];
  for (const group of result) {
    group.merchants=new Set(group.quotes.map(row=>row.site_id)).size;
    group.quotes.sort((a,b)=>a.cny_amount-b.cny_amount||a.id-b.id);
  }
  return {groups:result.sort((a,b)=>b.merchants-a.merchants||b.quotes.length-a.quotes.length||Number(b.period==="月")-Number(a.period==="月")||a.key.localeCompare(b.key)),rateDay:day,missingExchange};
}
