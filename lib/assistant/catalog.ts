import type { DatabaseSync } from "node:sqlite";
import { mentionedAiProducts } from "@/lib/directory/ai-product";
import { canonicalAiTier } from "@/lib/directory/ai-subscription-tier";
import { aiPriceDeliveryLabels, publicPriceBoard, type AiPriceDelivery } from "@/lib/directory/price-board";
import { listSites, publicEditorials } from "@/lib/directory/read";
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

export function assistantCatalogIntent(question: string) {
  const text = question.normalize("NFKC").trim();
  const plan = text.replace(/\b(?:chat[ -]*)?gpt(?=\b|plus|pro|go|business)/gi, "ChatGPT")
    .replace(/\b(chatgpt|claude|gemini|grok)[ -]*(?=plus|pro|max|ultra|premium|business|team|go\b)/gi,"$1 ");
  const products = mentionedAiProducts(plan);
  if (products.length && (lowest.test(text) || highest.test(text) || quoteTerms.test(text))) {
    const product = products[0];
    return { kind: "price" as const, product, tier: products.length === 1 ? canonicalAiTier(product, plan) : undefined,
      highest: !lowest.test(text) && highest.test(text), annual: year.test(text) && !month.test(text),
      deliveries: deliveryKinds.filter(kind => deliveryMatches[kind].test(text)),
      todayOnly: /(?:只看|仅看|僅看|限定|只要).{0,4}(?:今天|今日)|(?:今天|今日|当天|當天)(?:的)?(?:核[对對]|核实|核實|观测|觀測)|(?:only|verified) today/i.test(text),
    };
  }
  if (newsTerms.test(text)) {
    const topic = /(?:关于|關於|有关|有關|about)\s*(.+?)(?:的)?(?:[资資][讯訊]|新[闻聞]|文章|[报報]道|[？?。!！]|$)/i.exec(text)?.[1]?.trim();
    return { kind: "news" as const, topic: topic?.slice(0, MAX_QUERY_LENGTH) };
  }
  if (merchantTerms.test(text)) {
    const named = /\b(?:website|storefront|link)\s+(?:for|of)\s+(.+)$/i.exec(text)?.[1];
    const query = (named ?? text.replace(/^(?:请问|請問|我想(?:找|查)|帮我(?:找|查)(?:一下)?|幫我(?:找|查)(?:一下)?|给我|給我|查一下|找一下|what is|where is|find)\s*/i, "")
      .replace(/\s*(?:的)?(?:官[网網]|官方[网網]站|店[铺鋪][链鏈]接|商家[资資]料|[链鏈]接|website|storefront).*$/i, ""))
      .replace(/^[“「"']|[？?。!！“」"']$/g, "").trim().slice(0, MAX_QUERY_LENGTH);
    if (query && query !== text) return { kind: "merchant" as const, query };
  }
}

type Intent = NonNullable<ReturnType<typeof assistantCatalogIntent>>;
const dateInShanghai = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
function localDay(value: string | number) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const stamp = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(stamp) ? dateInShanghai.format(stamp) : "";
}

function plainLabel(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/[[\]*_`]/g, char => ({ "[": "［", "]": "］", "*": "＊", "_": "＿", "`": "｀" })[char]!).trim();
}

export function assistantCatalogReply(intent: Intent, db: DatabaseSync, visibility: ContentVisibility, language: SiteLanguage, now = Date.now()) {
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
  function textReply(text: string) { return { text, links: [...links] }; }
  if (intent.kind === "merchant") {
    const { rows } = listSites({ q: intent.query, lifecycle: "current", size: 4, visibility }, db);
    if (!rows.length) return textReply(t("站内暂时没有找到匹配的公开商家。"));
    const name = compact(canonicalize(intent.query));
    const exact = rows.find(site => [site.name, site.domain, site.slug].some(candidate => candidate && compact(canonicalize(candidate)) === name));
    const matches = exact ? [exact] : rows;
    const items = matches.map(site => `- ${[link(site.name, siteHref(site.slug)), plainLabel(t(site.category_label)),
      origin(t("访问商家页面"), site.website)].filter(Boolean).join(" · ")}`);
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

  const { tier, product } = intent;
  if (!tier) return textReply(t("请告诉我你要查的订阅等级，例如 ChatGPT Plus、ChatGPT Pro 200 或 Claude Pro。"));
  const day = localDay(now);
  const billing = intent.annual ? "year" : "month";
  const period = intent.annual ? "年" : "月";
  const groups = publicPriceBoard(db, now, false, visibility).groups;
  const formatter = new Intl.NumberFormat(language, { style: "currency", currency: "CNY" });
  const deliveries = intent.deliveries.length ? intent.deliveries : deliveryKinds;
  const items = deliveries.flatMap(delivery => {
    const group = groups.find(g => g.category === "ai" && g.product === product && g.tier === tier && g.period === period && g.delivery === delivery);
    const available = group?.quotes.filter(quote => !intent.todayOnly || localDay(quote.feed_observed_at ?? quote.stock_checked_at ?? quote.recorded_at) === day) ?? [];
    const quote = intent.highest ? available.at(-1) : available[0];
    if (!quote) return [];
    const price = formatter.format(quote.cny_minor / 100);
    const evidenceDay = localDay(quote.feed_observed_at ?? quote.stock_checked_at ?? quote.recorded_at);
    const money = quote.currency === "CNY" ? price : t("约 {price}", { price });
    const shop = link(quote.site_name, `${siteHref(quote.site_slug)}#prices`);
    const source = origin(t("原商品页"), quote.reported_item_url) || origin(t("报价来源"), quote.source_url);
    return [`- ${t(aiPriceDeliveryLabels[delivery])} · **${money}** · ${shop}${source ? ` · ${source}` : ""} · ${t("报价日期 {date}", { date: evidenceDay })}`];
  });
  const scope = `${product} ${tier} · ${t(`${period}付`)}`;
  const range = new URLSearchParams({ price: "ai", product, tier, billing, ...(intent.deliveries.length === 1 && { delivery: intent.deliveries[0] }) });
  const board = link(t("公开报价区间"), `/?${range}#home-prices`);
  if (!items.length) return textReply(`${t(intent.todayOnly ? "{scope} 今天暂无可比报价。" : "{scope} 暂无可比报价。", { scope })}\n\n${board}`);
  const headline = t(intent.highest ? "截至 {date}，{scope} 的站内最高可比报价。" : "截至 {date}，{scope} 的站内最低可比报价。", { date: day, scope });
  return textReply([headline, items.join("\n"), board].join("\n\n"));
}
