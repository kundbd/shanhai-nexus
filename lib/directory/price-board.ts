import { all, directory } from "./db";
import { exchangeRates,toCnyAmount } from "./exchange-rates";
import { aiSubscriptionTier,conflictsWithObservedAiTier } from "./ai-subscription-tier";
import { aiProducts,codexVerificationProduct,mentionedAiProducts,mentionsCodex,officialAiProduct } from "./ai-product";
import { isRelayTokenPeriod } from "./relay-quote-units";
import { relayModelKey } from "./relay-models";
import { publicPriceEvidence } from "./public-quote-policy";
import { storefrontAvailabilityAge } from "./storefront-availability";
import { storefrontFeedAge,type FeedCheck } from "./storefront-feed";
import type { Price } from "./types";

export type PublishedQuote = Price & { site_slug:string; site_name:string; category_slug:string; category_label:string; source_kind:string; avatar_digest:string|null; stock_checked_at?:string|null;
  stock_state?:"available"|"unavailable"|"unconfirmed"|null;
  feed_observed_at?:string|null; feed_snapshot_url?:string|null; feed_amount_minor?:number|null;
  feed_outcome?:FeedCheck|null; feed_checked_at?:string|null; feed_review_url?:string|null; feed_published_at?:string|null };

export const priceRecordedTime=(column:string)=>`julianday(CASE WHEN length(${column})=10 THEN ${column} || 'T00:00:00+08:00' ELSE ${column} END)`;

function publishedQuotes(db:ReturnType<typeof directory>,includeStorefronts:boolean,site?:number|readonly number[],visibility?:ContentVisibility) {
  const scope=typeof site==="number"?"AND p.site_id=?":site?"AND p.site_id IN (SELECT value FROM json_each(?))":"";
  const region=siteVisibility(visibility);
  return all<PublishedQuote>(db,`WITH ranked AS (
    SELECT p.*,s.slug site_slug,s.name site_name,c.slug category_slug,c.label category_label,
      src.url source_url,src.title source_title,src.kind source_kind,avatar.digest avatar_digest,stock.checked_at stock_checked_at,stock.state stock_state,
      feed.observed_at feed_observed_at,feed.snapshot_url feed_snapshot_url,feed.amount_minor feed_amount_minor,
      review.outcome feed_outcome,review.observed_at feed_checked_at,run.reviewed_snapshot_url feed_review_url,run.published_at feed_published_at,
      row_number() OVER (PARTITION BY p.site_id,p.storefront_observed,p.reported_item_url,
        CASE WHEN p.reported_item_url IS NULL THEN p.plan END,
        CASE WHEN p.reported_item_url IS NULL THEN p.currency END,
        CASE WHEN p.reported_item_url IS NULL THEN p.period END,
        CASE WHEN p.reported_item_url IS NULL THEN p.region END,
        CASE WHEN p.storefront_observed=1 AND p.reported_item_url IS NULL THEN src.url END
        ORDER BY ${priceRecordedTime("p.recorded_at")} DESC,p.id DESC) position
    FROM price_records p JOIN sites s ON s.id=p.site_id JOIN categories c ON c.slug=s.category_slug
      JOIN sources src ON src.id=p.source_id
      LEFT JOIN merchant_avatars avatar ON avatar.site_id=s.id AND avatar.website=s.website
      LEFT JOIN storefront_quote_checks stock ON stock.quote_id=p.id
        AND stock.source_id=p.source_id AND stock.amount_minor=p.amount_minor
      LEFT JOIN storefront_feed_quotes feed ON feed.quote_id=p.id AND p.reported_item_url IS NOT NULL AND src.kind='media'
      LEFT JOIN storefront_feed_state run ON run.id=1 AND run.reviewed_snapshot_url=run.snapshot_url AND p.reported_item_url IS NOT NULL AND src.kind='media'
      LEFT JOIN storefront_feed_checks review ON review.quote_id=p.id AND run.id IS NOT NULL
    WHERE p.publication='published' AND s.publication='published' AND s.lifecycle<>'closed'
    AND ${publicPriceEvidence}
    AND (p.storefront_observed=0 OR (?=1 AND s.category_slug IN ('ai-topup','ai-card')))
    ${scope} AND ${region.clause}
  ) SELECT * FROM ranked WHERE position=1 ORDER BY category_slug,site_id,id`,Number(includeStorefronts),
    ...(site===undefined?[]:[typeof site==="number"?site:JSON.stringify(site)]),...region.bindings);
}

export const currentPublicQuotes=(db=directory())=>publishedQuotes(db,false).filter(quote=>quote.amount_scale==null);

export function refreshablePublicQuotes(db:ReturnType<typeof directory>,site?:number) {
  return publishedQuotes(db,true,site).filter(quote=>quote.source_kind==="official"&&!quote.reported_item_url);
}

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
  const category=quote.category_slug;
  if (category==="airport"||category==="vpn"||category==="vps"||category==="ai-relay") return {category,product:null} as const;
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

const unavailableQuote=/缺货|售罄|停售|已下架|过有效期|预售|异常低价/;
const partialProduct=/半成品|试用|体验(?:号|账号|版|套餐)|补差价|补款|押金|定金/;
const supplementalPayment=/补差价|补款|押金|定金/;

function recentObservation(stamp:string|null|undefined,now:number,maxAge:number) {
  const checked=Date.parse(stamp??"");
  return checked<=now&&now-checked<=maxAge;
}

function recentFeedQuote(recorded:PublishedQuote,now:number) {
  const {feed_observed_at,feed_snapshot_url,feed_amount_minor}=recorded;
  if (!feed_observed_at||!feed_snapshot_url||feed_amount_minor==null||
      !recentObservation(feed_observed_at,now,storefrontFeedAge)) return;
  return {...recorded,amount_minor:feed_amount_minor,source_url:feed_snapshot_url,recorded_at:feed_observed_at,notes:"近期第三方有货观测"};
}

function directStockAvailable(quote:PublishedQuote,now:number) {
  return quote.source_kind==="official"&&!quote.reported_item_url&&quote.stock_state==="available"&&
    recentObservation(quote.stock_checked_at,now,storefrontAvailabilityAge);
}

export type StartingPrice={cnyAmount:number;period:string;converted:boolean;referenceAt?:string};
export function catalogStartingPrices(db:ReturnType<typeof directory>,siteIds:readonly number[],now=Date.now(),visibility?:ContentVisibility) {
  const prices=new Map<number,StartingPrice>();
  if (!siteIds.length) return prices;
  const references=new Map<number,StartingPrice>();
  const {byCurrency}=exchangeRates(db);
  for (const recorded of publishedQuotes(db,true,siteIds,visibility)) {
    const feedQuote=recentFeedQuote(recorded,now);
    const quote=feedQuote??recorded;
    // A merchant's own list price is useful in the directory even when stock is unspecified.
    const directListPrice = quote.source_kind === "official" && !quote.reported_item_url && quote.stock_state !== "unavailable";
    const reference = quote.storefront_observed === 1 && !feedQuote && !directListPrice;
    if (reference && (quote.source_kind !== "media" || !quote.reported_item_url ||
      quote.feed_outcome === "out_of_stock" || quote.feed_outcome === "identity_conflict" || quote.feed_outcome === "terms_changed")) continue;
    const title=`${quote.plan} ${quote.product_title??""}`;
    if (unavailableQuote.test(`${title} ${quote.notes}`)||supplementalPayment.test(title)||storefrontTierNeedsReview(quote)) continue;
    if (quote.currency!=="CNY"&&quote.amount_minor!==0&&(!byCurrency.has(quote.currency)||!byCurrency.has("CNY"))) continue;
    const amount=toCnyAmount(quote.amount_minor,quote.currency,byCurrency,quote.amount_scale??undefined);
    if (amount===undefined||!Number.isSafeInteger(Math.round(amount*100))) continue;
    const precision=amount>0&&amount<0.01?8:Math.max(2,quote.amount_scale??2);
    const cnyAmount=Number(amount.toFixed(precision));
    if (amount>0&&cnyAmount===0) continue;
    const result=reference?references:prices;
    if (cnyAmount<(result.get(quote.site_id)?.cnyAmount??Infinity)) {
      result.set(quote.site_id,{cnyAmount,period:comparablePeriod(quote.period),converted:quote.currency!=="CNY"&&amount!==0,
        ...(reference&&{referenceAt:quote.recorded_at})});
    }
  }
  for (const [site, price] of references) if (!prices.has(site)) prices.set(site,price);
  return prices;
}

export const aiPriceDeliveryLabels = {
  topup: "代充",
  account: "成品号",
  code: "卡密",
  seat: "共享席位",
  official: "官方订阅",
  other: "其他报价",
} as const;
export type AiPriceDelivery = keyof typeof aiPriceDeliveryLabels;

const retailDeliveryPatterns = {
  topup: /代充|直充|自充|(?:本人|原有?|自己|自有)[账帐]号.{0,8}(?:充值|续费)|\b(?:top[ -]?up|recharge)\b/i,
  account: /成品(?:[账帐]号|号)|独享(?:[账帐]号|号)|(?:交付|提供)[账帐]号密码|\b(?:pre[ -]?made|ready[ -]?made) accounts?\b/i,
  code: /卡密|兑换码|礼品卡|\b(?:redeem code|gift card|voucher)\b/i,
  seat: /共享(?:席位|[账帐]号|号)|团队席位|合租|拼车|车位|(?:^|·)\s*共享(?:\s|$)|\b(?:shared account|team seat)\b/i,
} as const;

function aiPriceDelivery(quote: PublishedQuote): AiPriceDelivery | undefined {
  if (!quote.storefront_observed && quote.category_slug === "ai-subscriptions" && officialAiProduct(quote.site_slug)) {
    return "official";
  }
  const text = `${quote.plan} ${quote.product_title ?? ""}`.normalize("NFKC");
  if (partialProduct.test(text)) return;
  const kinds = (Object.keys(retailDeliveryPatterns) as (keyof typeof retailDeliveryPatterns)[])
    .filter((kind) => retailDeliveryPatterns[kind].test(text));
  // An offer with incompatible delivery labels stays in the merchant's price history.
  if (kinds.length > 1) return;
  return kinds[0] ?? "other";
}

export type PricedInCny=PublishedQuote & {cny_minor:number;cny_amount:number};
export const excludedQuoteLabels={
  unavailable:"原页报告不可售",
  out_of_stock:"该轮观测缺货",
  stale:"观测已过期",
  terms_changed:"规格或标题有变动",
  identity_conflict:"商品与店铺归属冲突",
  uncertain:"库存或价格待核对",
  unseen:"本轮快照未收录原商品",
  unchecked:"暂无近期在售证据",
} as const;
export type ExcludedQuote={quote:PricedInCny;state:keyof typeof excludedQuoteLabels;evidenceUrl?:string|null;evidenceAt?:string|null};
type QuoteGroup={key:string;category:PriceCategory;product:string|null;tier:string|null;period:string;delivery:AiPriceDelivery|null;region:string|null;subcategory:string|null;
  quotes:PricedInCny[];merchants:number;unconfirmedStorefronts:number;excludedQuotes:ExcludedQuote[]};

function excludedQuote(quote:PricedInCny):ExcludedQuote {
  if (quote.feed_review_url) {
    const state=quote.feed_outcome==="in_stock"?"stale":quote.feed_outcome??"unseen";
    return {quote,state,evidenceUrl:quote.feed_review_url,evidenceAt:quote.feed_checked_at??quote.feed_published_at};
  }
  const state=quote.stock_state==="unavailable"?"unavailable":quote.stock_state==="available"?"stale":quote.stock_state==="unconfirmed"?"uncertain":"unchecked";
  return {quote,state,evidenceUrl:quote.stock_state?quote.source_url:null,evidenceAt:quote.stock_checked_at};
}

export function publicPriceBoard(db=directory(),now=Date.now(),includeExcluded=false,visibility?:ContentVisibility) {
  const {day,byCurrency}=exchangeRates(db);
  const groups=new Map<string,QuoteGroup>();
  const relayModelNames=new Map<string,string>();
  let missingExchange=0;
  for (const recorded of publishedQuotes(db,true,undefined,visibility)) {
    const feedQuote=recentFeedQuote(recorded,now);
    const quote=feedQuote??recorded;
    if (quote.storefront_observed&&(unavailableQuote.test(quote.notes)||partialProduct.test(quote.plan)||partialProduct.test(quote.product_title??""))) continue;
    const scope=quoteCategory(quote);
    if (!scope) continue;
    const period=boardPeriod(quote,scope.product);
    const verification=scope.product===codexVerificationProduct;
    if(verification&&(period!=="每次"||quote.amount_minor<=0))continue;
    const tier=scope.product&&!verification?aiSubscriptionTier(scope.product,quote.plan,period,quote.amount_minor):null;
    if (scope.product&&!verification&&!tier) continue;
    if (scope.product&&tier&&conflictsWithStorefrontTitle(quote,scope.product,tier,period)) continue;
    const delivery=scope.product&&!verification?aiPriceDelivery(quote):null;
    if (delivery===undefined) continue;
    const cny=toCnyAmount(quote.amount_minor,quote.currency,byCurrency,quote.amount_scale??undefined);
    if (cny===undefined || !Number.isSafeInteger(Math.round(cny*100))) { missingExchange++; continue; }
    const observedRegion=quote.region.trim();
    const networkRegionUnspecified=(scope.category==="airport"||scope.category==="vpn")&&observedRegion==="未注明";
    const region=scope.product?null:unspecifiedRegion(observedRegion)||networkRegionUnspecified||observedRegion==="公开免费计划"?"报价地区未注明":observedRegion;
    let relayModel:string|null=null;
    if (scope.category==="ai-relay"&&isRelayTokenPeriod(period)) {
      const identity=relayModelKey(quote.plan);
      relayModel=relayModelNames.get(identity)??quote.plan;
      relayModelNames.set(identity,relayModel);
    }
    const subcategory=relayModel??(scope.category==="payments"?quote.category_label:null);
    const dimensions=[scope.category,null,period,region];
    if(subcategory) dimensions.push(relayModel??quote.category_slug);
    const key=scope.product?JSON.stringify([scope.category,scope.product,tier,period,...(delivery?[delivery]:[])]):JSON.stringify(dimensions);
    const group=groups.get(key)??{key,...scope,tier:tier??null,period,delivery,region,subcategory,quotes:[],merchants:0,unconfirmedStorefronts:0,excludedQuotes:[]};
    groups.set(key,group);
    if (quote.storefront_observed&&!feedQuote&&!directStockAvailable(quote,now)) {
      group.unconfirmedStorefronts++;
      if (includeExcluded) group.excludedQuotes.push(excludedQuote({...quote,cny_minor:Math.round(cny*100),cny_amount:cny}));
      continue;
    }
    if (relayModel&&group.quotes.some(row=>row.site_id===quote.site_id&&row.source_url===quote.source_url&&
      row.currency===quote.currency&&row.amount_minor===quote.amount_minor&&row.amount_scale===quote.amount_scale)) continue;
    group.quotes.push({...quote,cny_minor:Math.round(cny*100),cny_amount:cny});
  }
  const result=[...groups.values()];
  for (const group of result) {
    group.merchants=new Set(group.quotes.map(row=>row.site_id)).size;
    group.quotes.sort((a,b)=>a.cny_amount-b.cny_amount||a.id-b.id);
  }
  return {groups:result.sort((a,b)=>b.merchants-a.merchants||b.quotes.length-a.quotes.length||Number(b.period==="月")-Number(a.period==="月")||a.key.localeCompare(b.key)),rateDay:day,missingExchange};
}
import { siteVisibility, type ContentVisibility } from "../geo/visibility";
