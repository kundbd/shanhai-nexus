import type { DatabaseSync } from "node:sqlite";
import { mentionedAiProducts } from "@/lib/directory/ai-product";
import { canonicalAiTier } from "@/lib/directory/ai-subscription-tier";
import { aiPriceDeliveryLabels, comparablePeriod, priceCategories, publicPriceBoard, type AiPriceDelivery, type PricedInCny } from "@/lib/directory/price-board";
import { latestPrices, listSites, publicEditorials, publicPrices } from "@/lib/directory/read";
import { productHref, productName } from "@/lib/directory/products";
import { isRelayTokenPeriod, relayTokenPeriods } from "@/lib/directory/relay-quote-units";
import { relayModelBrand } from "@/lib/directory/relay-models";
import { directorySearch } from "@/lib/directory/search-query";
import { observationHref, siteHref } from "@/lib/directory/types";
import type { ContentVisibility } from "@/lib/geo/visibility";
import type { SiteLanguage, Translate } from "@/lib/i18n/language";
import { translationsForLanguage } from "@/lib/i18n/server";
import { canonicalize, compact, MAX_QUERY_LENGTH } from "@/lib/search/query";
import { assistantCatalogHref } from "./protocol";

const year = /年[付费費繳缴卡]|annual|yearly|per year/i;
const month = /月[付费費繳缴卡]|monthly|per month/i;
const lowest = /最便宜|最低|最平|最偏|最划算|cheapest|lowest/i;
const highest = /最[贵貴高]|most expensive|highest/i;
const deliveryMatches: Record<AiPriceDelivery, RegExp> = {
  topup: /代[充儲储]|[直自]充|top[ -]?up|recharge/i,
  account: /成品[号號帳账]|独享[号帳账]|獨享[號帳账]|ready[ -]?made account|pre[ -]?made account/i,
  code: /卡密|[兑兌][换換][码碼]|redeem code|gift card/i,
  seat: /共享|合租|拼[車车]|席位|shared account|team seat/i,
  official: /官方(?:[订訂][阅閱])?|官[价價]|\bofficial\b/i,
  other: /其他[报報][价價]|other offers/i,
};
const deliveryKinds = Object.keys(aiPriceDeliveryLabels) as AiPriceDelivery[];
const quoteTerms = /哪(?:一)?家|[报報定售][价價]|[价價]格|多少[钱錢]|price|cost|how much/i;
const merchantTerms = /官[网網]|官方[网網]站|店[家铺鋪]|商家|[链鏈]接|\b(?:website|storefront|merchant|shop)\b/i;
const newsTerms = /[资資][讯訊]|新[闻聞]|山海[观觀]察|(?:最近|最新|[站网網][内內])[^？?。]{0,18}(?:[报報]道|文章)|\bnews\b|\b(?:recent|latest|site) articles?\b/i;

export function assistantCategory(question: string): Exclude<keyof typeof priceCategories, "ai"> | undefined {
  if (/\b(?:ai\s+)?api\b|\btoken[s]?\b|中[转轉]站|接口[价價]格/i.test(question)) return "ai-relay";
  if (/机场|機場|[节節]点[订訂][阅閱]/i.test(question)) return "airport";
  if (/\bvpn\b/i.test(question)) return "vpn";
  if (/\bvps\b|[云雲](?:服务器|伺服器|主[机機])|cloud hosting/i.test(question)) return "vps";
  if (/\bu\s*卡|虚拟卡|虛擬卡|[虚虛][拟擬]信用卡|跨境支付|virtual card/i.test(question)) return "payments";
}

export function assistantCatalogIntent(question: string) {
  const text = question.normalize("NFKC").trim();
  const plan = text.replace(/\b(?:chat[ -]*)?gpt(?=\b|plus|pro|go|business)/gi, "ChatGPT")
    .replace(/\b(chatgpt|claude|gemini|grok)[ -]*(?=plus|pro|max|ultra|premium|business|team|go\b)/gi,"$1 ");
  const products = mentionedAiProducts(plan);
  const comparison = lowest.test(text) || highest.test(text) || quoteTerms.test(text);
  const descending = !lowest.test(text) && highest.test(text);
  const todayOnly = /(?:只看|仅看|僅看|限定|只要).{0,4}(?:今天|今日)|(?:今天|今日|当天|當天)(?:的)?(?:核[对對]|核实|核實|观测|觀測)|(?:only|verified) today/i.test(text);
  const category = assistantCategory(text);
  const annual = year.test(text) && !month.test(text);
  if (category && comparison) return { kind: "board" as const, category, text, highest: descending, todayOnly,
    period: /(?:输入|輸入|input)/i.test(text) && category === "ai-relay" ? relayTokenPeriods[0]
      : /(?:输出|輸出|output)/i.test(text) && category === "ai-relay" ? relayTokenPeriods[1] : annual ? "年" : month.test(text) ? "月" : undefined };
  if (products.length && comparison) {
    const product = products[0];
    return { kind: "price" as const, product, tier: products.length === 1 ? canonicalAiTier(product, plan) : undefined,
      highest: descending, annual,
      deliveries: deliveryKinds.filter(kind => deliveryMatches[kind].test(text)),
      todayOnly,
    };
  }
  if (newsTerms.test(text) && !/官[网網]|商家[资資]料|website/i.test(text)) {
    const topic = /(?:关于|關於|有关|有關|about)\s*(.+?)(?:的)?(?:[资資][讯訊]|新[闻聞]|文章|[报報]道|[？?。!！]|$)/i.exec(text)?.[1]?.trim();
    return { kind: "news" as const, topic: topic?.slice(0, MAX_QUERY_LENGTH) };
  }
  if (merchantTerms.test(text) || comparison) {
    const named = /\b(?:website|storefront|link)\s+(?:for|of)\s+(.+)$/i.exec(text)?.[1];
    const ending = merchantTerms.test(text)
      ? /\s*(?:的)?(?:官[网網]|官方[网網]站|店[铺鋪][链鏈]接|商家[资資]料|[链鏈]接|website|storefront).*$/i
      : /\s*(?:的)?(?:[报報][价價]|[价價]格|多少[钱錢])(?:[是呢多少怎麼么樣样\s？?。!！]*)$/i;
    const query = (named ?? text.replace(/^(?:请问|請問|我想(?:找|查)|帮我(?:找|查)(?:一下)?|幫我(?:找|查)(?:一下)?|给我|給我|查一下|找一下|what is|where is|find)\s*/i, "")
      .replace(ending, ""))
      .replace(/^[“「"']|[？?。!！“」"']$/g, "").trim().slice(0, MAX_QUERY_LENGTH);
    if (query && query !== text && (merchantTerms.test(text) || /[价價]格|[报報][价價]|多少[钱錢]/i.test(text))) return { kind: "merchant" as const, query, withPrices: comparison };
  }
}

type Intent = NonNullable<ReturnType<typeof assistantCatalogIntent>>;
const dateInShanghai = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
export function localDay(value: string | number) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const stamp = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(stamp) ? dateInShanghai.format(stamp) : "";
}

export function plainLabel(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/[[\]*_`]/g, char => ({ "[": "［", "]": "］", "*": "＊", "_": "＿", "`": "｀" })[char]!).trim();
}

export function assistantReferences(visibility: ContentVisibility, language: SiteLanguage) {
  const t: Translate = translationsForLanguage(language);
  const links = new Set<string>();
  const link = (title: string, value: string | null) => {
    const label = plainLabel(visibility.filterText(title));
    const href = assistantCatalogHref(value);
    if (!value || !href || !visibility.linkAllowed(value)) return label;
    links.add(href);
    return `[${label}](${href})`;
  };
  const origin = (title:string, href:string|null) => {
    const value = assistantCatalogHref(href);
    return href && value && visibility.linkAllowed(href) ? link(title, href) : "";
  };
  return { t, link, origin, textReply: (text: string) => ({ text, links: [...links] }) };
}

export function assistantCatalogReply(intent: Intent, db: DatabaseSync, visibility: ContentVisibility, language: SiteLanguage, now = Date.now()) {
  const { t, link, origin, textReply } = assistantReferences(visibility, language);
  if (intent.kind === "merchant") {
    const { rows } = listSites({ q: intent.query, lifecycle: "current", size: 4, visibility }, db);
    if (!rows.length) return textReply(t("站内暂时没有找到匹配的公开商家。"));
    const name = compact(canonicalize(intent.query));
    const exact = rows.find(site => [site.name, site.domain, site.slug, ...JSON.parse(site.aliases) as string[]]
      .some(candidate => candidate && compact(canonicalize(candidate)) === name));
    const matches = exact ? [exact] : rows;
    const items = matches.map(site => `- ${[link(site.name, siteHref(site.slug)), plainLabel(t(site.category_label)),
      origin(t("访问商家页面"), site.website), plainLabel(visibility.filterText(site.summary)).slice(0, 120)].filter(Boolean).join(" · ")}`);
    if (intent.withPrices && exact) {
      const prices = latestPrices(publicPrices(exact.id, db)).slice(0, 4);
      if (prices.length) items.push("", t("商品与标价"), "", ...prices.map(price => {
        const amount = new Intl.NumberFormat(language, { style: "currency", currency: price.currency, maximumFractionDigits: 8 })
          .format(price.amount_minor / 10 ** (price.amount_scale ?? 2));
        return `- ${link(productName(price), productHref(price))} · **${amount}** · ${t(comparablePeriod(price.period))} · ${t("报价日期 {date}", { date: localDay(price.recorded_at) })}`;
      }));
    }
    return textReply(`${t("站内公开商家档案")}\n\n${items.join("\n")}`);
  }
  if (intent.kind === "news") {
    const search = intent.topic ? directorySearch(intent.topic, false) : undefined;
    const rows = publicEditorials(undefined, search ? -1 : 4, db, visibility);
    const matches = search ? rows.map(entry => ({ entry, score: search.score([
      { text: visibility.filterText(entry.title), weight: 12 }, { text: visibility.filterText(entry.summary), weight: 8 },
    ]) })).filter(result => result.score > 0).sort((a,b) => b.score - a.score).slice(0, 4).map(result => result.entry) : rows;
    if (!matches.length) return textReply(t("站内暂时没有找到匹配的公开资讯。"));
    const items = matches.map(entry => `- ${[link(entry.title, observationHref(entry.slug)), localDay(entry.updated_at),
      plainLabel(visibility.filterText(entry.summary)).slice(0, 110)].filter(Boolean).join(" · ")}`);
    return textReply(`${t("站内公开资讯")}\n\n${items.join("\n")}`);
  }

  const day = localDay(now);
  const observedDay = (quote: PricedInCny) => localDay(quote.feed_observed_at ?? quote.stock_checked_at ?? quote.recorded_at);
  const select = (quotes: PricedInCny[]) => {
    const visible = intent.todayOnly ? quotes.filter(quote => observedDay(quote) === day) : quotes;
    return intent.highest ? visible.at(-1) : visible[0];
  };
  function quoteLine(quote: PricedInCny, group: string) {
    const formatter = new Intl.NumberFormat(language, { style: "currency", currency: "CNY", maximumFractionDigits: isRelayTokenPeriod(quote.period) ? 6 : 2 });
    const price = formatter.format(isRelayTokenPeriod(quote.period) ? quote.cny_amount : quote.cny_minor / 100);
    const money = quote.currency === "CNY" ? price : t("约 {price}", { price });
    const shop = link(quote.site_name, `${siteHref(quote.site_slug)}#prices`);
    const source = origin(t("原商品页"), quote.reported_item_url) || origin(t("报价来源"), quote.source_url);
    return `- ${group} · **${money}** · ${shop}${source ? ` · ${source}` : ""} · ${t("报价日期 {date}", { date: observedDay(quote) })}`;
  }
  const headline = (scope: string) => t(intent.highest ? "截至 {date}，{scope} 的站内最高可比报价。" : "截至 {date}，{scope} 的站内最低可比报价。", { date: day, scope });
  const empty = (scope: string) => t(intent.todayOnly ? "{scope} 今天暂无可比报价。" : "{scope} 暂无可比报价。", { scope });
  if (intent.kind === "board") {
    const scope = t(priceCategories[intent.category]);
    let groups = publicPriceBoard(db, now, false, visibility).groups.filter(group => group.category === intent.category && (!intent.period || t(group.period) === t(intent.period)));
    if (intent.category === "ai-relay") {
      const phrase = canonicalize(intent.text);
      const models = [...new Set(groups.flatMap(group => group.subcategory ? [group.subcategory] : []))];
      const model = models.filter(value => {
        const pattern = canonicalize(value).split(/[\s_\p{Pd}]+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("[\\s_-]*");
        return new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9]|\\.\\d)`,"i").test(phrase);
      }).sort((a,b) => b.length - a.length)[0];
      if (model) groups = groups.filter(group => group.subcategory === model);
      else {
        const brand = /\b(?:gpt|openai|claude|deepseek|gemini|glm|kimi|minimax|qwen|grok)\b/i.exec(phrase)?.[0];
        if (brand) groups = /\d[.]\d|\b[vr]\d|\b(?:sonnet|opus|flash|haiku)\b/i.test(phrase) ? [] : groups.filter(group => group.subcategory &&
          relayModelBrand(group.subcategory)?.toLowerCase() === (brand === "gpt" ? "openai" : brand));
      }
    }
    const items = groups.flatMap(group => {
      const quote = select(group.quotes);
      return quote ? [{quote, group}] : [];
    }).slice(0, 5).map(({quote, group}) => {
      const details = [group.subcategory, group.period, group.region].filter((part): part is string => !!part).map(part => plainLabel(t(part)));
      return quoteLine(quote, details.join(" · "));
    });
    const network = intent.category === "airport" || intent.category === "vpn";
    const board = !network || visibility.categoryAllowed(intent.category) ? link(t("公开报价区间"), `/?price=${intent.category}#home-prices`) : "";
    return textReply([items.length ? headline(scope) : empty(scope), items.join("\n"), board].filter(Boolean).join("\n\n"));
  }

  const { tier, product } = intent;
  if (!tier) return textReply(t("请告诉我你要查的订阅等级，例如 ChatGPT Plus、ChatGPT Pro 200 或 Claude Pro。"));
  const billing = intent.annual ? "year" : "month";
  const period = intent.annual ? "年" : "月";
  const groups = publicPriceBoard(db, now, false, visibility).groups;
  const deliveries = intent.deliveries.length ? intent.deliveries : deliveryKinds;
  const items = deliveries.flatMap(delivery => {
    const group = groups.find(g => g.category === "ai" && g.product === product && g.tier === tier && g.period === period && g.delivery === delivery);
    const quote = select(group?.quotes ?? []);
    return quote ? [quoteLine(quote, t(aiPriceDeliveryLabels[delivery]))] : [];
  });
  const scope = `${product} ${tier} · ${t(`${period}付`)}`;
  const range = new URLSearchParams({ price: "ai", product, tier, billing, ...(intent.deliveries.length === 1 && { delivery: intent.deliveries[0] }) });
  const board = link(t("公开报价区间"), `/?${range}#home-prices`);
  return textReply([items.length ? headline(scope) : empty(scope), items.join("\n"), board].filter(Boolean).join("\n\n"));
}
