import type { DatabaseSync } from "node:sqlite";
import { brand } from "@/lib/brand";
import { tools } from "@/lib/catalog";
import { postHref } from "@/lib/community/limits";
import { communityPost, publicPostMatches } from "@/lib/community/posts";
import { discussionHref, publicThread, publicThreadMatches } from "@/lib/directory/community";
import { getPublicProduct, productHref, productName } from "@/lib/directory/products";
import { productRanking, shopRanking, type RankingPeriod } from "@/lib/directory/rankings";
import { countPublicSites, getSite, getSiteById, latestPrices, listPublicCategories, listSites, publicEditorial, publicEditorials, publicIncidents, publicPrices } from "@/lib/directory/read";
import { directorySearch } from "@/lib/directory/search-query";
import { pipelines, rankingCategories, type Pipeline } from "@/lib/directory/taxonomy";
import { categoryHref, observationHref, siteHref } from "@/lib/directory/types";
import type { ContentVisibility } from "@/lib/geo/visibility";
import type { SiteLanguage } from "@/lib/i18n/language";
import { searchCatalog } from "@/lib/search";
import { MAX_QUERY_LENGTH } from "@/lib/search/query";
import { announcementText, registrationCodeAdvice, siteAnnouncements } from "@/lib/site-announcements";
import { siteAgreementTerms } from "@/lib/site-consent";
import { assistantCategory, assistantReferences, localDay, plainLabel } from "./catalog";

const networkTerms = /代理\s*ip|住宅代理|网络代理|網絡代理|代理服務|网络限制|網絡限制/i;
const listingTerms = /(?:收[录錄]|[类類][别別]|分[类類]|目[录錄]|商家|店[铺鋪]|服[务務]商).{0,8}(?:多少|哪些|[几幾][家个個]|[数數]量)|(?:多少|哪些|[几幾][家个個]).{0,8}(?:商家|店[铺鋪]|分[类類]|服[务務]商)|服[务務]目[录錄]|\b(?:directories|directory|categories)\b/i;

function siteReference(question: string) {
  return /(?:https?:\/\/(?:www\.)?shanhainexus\.com|^|\s)(\/(?:services|observations|products|community)\/[a-z0-9-]+(?:\/[a-z0-9-]+)?)(?![a-z0-9%-])/i.exec(question)?.[1];
}

function siteTopic(question: string) {
  const explicit = /(?:关于|關於|有关|有關)\s*(.+?)(?:的)?(?:[评評][价價]|[贴帖]子|[议議]论|[资資][讯訊]|有哪|[？?。]|$)/i.exec(question)?.[1];
  return (explicit ?? question)
    .replace(/^(?:(?:能不能|可以|[请請][问問]|[帮幫]我|我想|了解|[介簡简][绍紹介](?:下|一下)?|[搜查找看](?:一下)?)\s*)+/i, "")
    .replace(/(?:有(?:哪[些家]|没有|沒有)|怎么样|怎麼樣|是什么|是什麼|有哪些)[？?。!！]*$/i, "")
    .replace(/(?:的)?(?:[评評][价價]|[评評][论論]|[贴帖]子|[报報][价價]|商品|商家|[资資][料訊讯]|信息|介绍|介紹|好不好|怎么样|怎麼樣|[吗嗎呢])(?:[？?。!！]|$)/gi, "")
    .replace(/[？?。!！]+$/, "").trim().slice(0, MAX_QUERY_LENGTH);
}

export function assistantSiteReply(question: string, db: DatabaseSync, visibility: ContentVisibility, language: SiteLanguage, now = Date.now()) {
  const {t, link, textReply} = assistantReferences(visibility, language);
  const q = question.normalize("NFKC");
  const category = assistantCategory(q) ?? (networkTerms.test(q) ? "proxy-services" : undefined);
  const topic = siteTopic(q);
  const withPage = (title: string, href: string, text: string) => textReply(`${text}\n\n${link(t(title),href)}`);
  const communityPath = /^\/community\/(posts\/)?([1-9]\d{0,14})$/.exec(siteReference(q) ?? "");
  if (communityPath) {
    const id = Number(communityPath[2]);
    const row = communityPath[1] ? communityPost(id, undefined, db) : publicThread(id, db, visibility);
    if (!row) return withPage("评论社区", "/community", t("暂无数据"));
    return withPage(communityPath[1] ? "公开帖子" : "商家评价", communityPath[1] ? postHref(id) : discussionHref(id),
      plainLabel(visibility.filterText(row.body)).slice(0, 500));
  }

  if (/(?:注册|註冊).{0,12}[验驗][证證][码碼]|(?:收不到|没收到|沒收到).{0,8}[验驗][证證][码碼]/i.test(q)) {
    return withPage("注册验证码提醒", "/messages", t(registrationCodeAdvice));
  }
  if (/公告|站[内內]通知|\bannouncements?\b/i.test(q)) {
    const ordinal = /第\s*([123一二三])\s*[条條]/.exec(q)?.[1];
    const selected = ordinal ? siteAnnouncements["一二三".includes(ordinal) ? "一二三".indexOf(ordinal) : Number(ordinal) - 1]
      : networkTerms.test(q) ? siteAnnouncements.find(item => item.id === "network-proxy-region") : undefined;
    const items = (selected ? [selected] : siteAnnouncements).map(announcement =>
      `- ${t(announcement.title)}${"publishedAt" in announcement ? ` · ${localDay(announcement.publishedAt)}` : ""} · ${announcementText[announcement.id].map(paragraph => t(paragraph)).join(" ")}`);
    return textReply([link(t("消息"), "/messages"), "", ...items].join("\n"));
  }
  if (/排行[榜名]?|[热熱][门門](?:商家|店[铺鋪]|商品)|\brankings?\b/i.test(q)) {
    const choice: Pipeline | undefined = category === "proxy-services" || category === "airport" || category === "vpn" ? "connections"
      : category || (/卡网|卡網|代充|发卡|發卡|AI[订訂][阅閱]/i.test(q) ? "ai-retail" : undefined);
    const product = /商品|products?/i.test(q);
    const period: RankingPeriod = /[综綜]合|累[计計]|overall|all[ -]time/i.test(q) ? "overall" : "24h";
    const groups = (Object.keys(pipelines) as Pipeline[]).filter(group => (!choice || choice === group) &&
      rankingCategories(group).some(slug => visibility.categoryAllowed(slug)));
    const rows = groups.flatMap(group => {
      const picked = product ? productRanking(db, group, period, now, visibility).map(row => ({
        href: row.path, name: productName(row.price), visitors: row.visitors,
      })) : shopRanking(db, group, period, now, visibility).map(row => ({ href: siteHref(row.slug), name: row.name, visitors: row.visitors }));
      return picked.slice(0, choice ? 3 : 1).map(row => `- ${t(pipelines[group].label)} · ${link(row.name,row.href)} · ${t("{count} 人", { count: row.visitors })}`);
    });
    const href = choice && groups.length ? `/rankings?group=${choice}&type=${product ? "products" : "shops"}&period=${period}` : "/rankings";
    return withPage("排行榜", href, [t(period === "24h" ? "按最近 24 小时的浏览人数排序。" : "按累计浏览人数排序。"),
      ...rows].join("\n"));
  }
  if (/(?:怎么|怎麼|如何).{0,12}(?:发帖|發帖|回复|回覆|匿名[评評][价價])/.test(q)) {
    return withPage("评论社区", "/community", t("可查商家档案、商品报价和山海观察。登录后可匿名评价商家，也可以用账号名在社区发帖和互动。"));
  }
  if (/评[论論]社区|評論社區|(?:社区|社區).{0,8}(?:帖子|貼文)|(?:[贴帖]子|貼文|商家[评評][价價]).{0,6}(?:有哪|[搜查找看]|最[新近])|(?:最近|最新).{0,6}(?:[贴帖]子|貼文)|\b(?:community posts|merchant reviews)\b/i.test(q) &&
    !/(?:怎么|怎麼|如何).{0,8}(?:发帖|發帖|回复|回覆|[评評][价價])/.test(q)) {
    const keyword = /(?:关于|關於|有关|有關)/.test(q) ? topic : "";
    const reviews = /[评評][价價]|reviews?/i.test(q);
    const rows = reviews ? publicThreadMatches(db, visibility, keyword).map(row => ({ href:discussionHref(row.id), title:row.site_name, body:row.body, date:row.submitted_at }))
      : publicPostMatches(db, keyword).map(row => ({ href:postHref(row.id), title:t("公开帖子"), body:row.body, date:row.created_at }));
    return withPage("评论社区", "/community", rows.map(row => `- ${link(row.title,row.href)} · ${localDay(row.date)} · ${plainLabel(visibility.filterText(row.body)).slice(0,110)}`).join("\n") ||
      t(reviews ? "暂无公开商家评价。" : "暂无帖子。"));
  }
  if (/最新[动動][态態]|(?:[价價]格|服[务務]|政策)(?:有[什啥]么)?[变變][动動化]|\b(?:recent updates|price changes)\b/i.test(q)) {
    const rows = publicIncidents(undefined, 6, db, visibility).slice(0, 5);
    return withPage("最新动态", "/updates", rows.map(row => `- ${link(row.site_name,`${siteHref(row.site_slug)}#incidents`)} · ${localDay(row.occurred_at)} · ${plainLabel(visibility.filterText(row.title))}`).join("\n") || t("暂无数据"));
  }
  if (listingTerms.test(q) || (category && /有哪些|有哪家|where to find|\bwhich\b/i.test(q))) {
    const options = { lifecycle:"current", visibility };
    const rows = listPublicCategories(db, visibility);
    const filtered = rows.filter(row => !category || row.slug === category);
    const total = category ? undefined : countPublicSites(options, db);
    const items = filtered.slice(0, 12).map(row => `- ${link(t(row.label),categoryHref(row.slug))} · ${t("公开档案 {count} 家", {
      count: countPublicSites({...options,category:row.slug},db),
    })}`);
    if (category && filtered.length && /哪些|有哪些|\bwhich\b/i.test(q)) {
      const shops = listSites({...options,category,size:5},db).rows;
      items.push(...shops.map(shop => `- ${link(shop.name,siteHref(shop.slug))}`));
    }
    return withPage("服务目录", "/services", [total === undefined ? "" : t("公开档案 {count} 家", {count:total}), ...items].filter(Boolean).join("\n") || t("暂无数据"));
  }
  if (/合作[联聯][系繫]|客[服诉訴]|投[稿訴诉]|纠错|糾錯|联系(?:方式|站长|本站)|聯繫|\bcontact\b/i.test(q) && !/(?:哪家|哪一家|代充|卡密|绑卡)/i.test(q)) {
    const cooperation = /合作|partner/i.test(q);
    return withPage(cooperation ? "合作联系" : "联系与纠错", cooperation ? "/contact#cooperation" : "/contact#feedback", cooperation ?
      `${t("合作联系")} · ${brand.cooperationEmail}` : t("通过表单提交资料、反馈站点问题或提出隐私相关请求。"));
  }
  if (/(?:本站|网站|網站|山海知序).{0,8}(?:怎么|怎麼|如何)(?:运作|運作)|本站是什么|關於本站|关于本站|\babout shanhai\b/i.test(q)) {
    return withPage("关于本站", "/about", t("可查商家档案、商品报价和山海观察。登录后可匿名评价商家，也可以用账号名在社区发帖和互动。"));
  }
  if (/[隐隱]私政策|\bprivacy polic(?:y|ies)\b/i.test(q)) {
    return withPage("隐私政策", "/policy#privacy", t("语言、主题偏好和公告的已读状态保存在当前浏览器。工具优先在浏览器本地处理输入。站内搜索词会出现在网址中，浏览器历史可能保留搜索地址。"));
  }
  if (/用[户戶][协協][议議]|[内內]容政策|免[责責]声明|地[区區](?:访问|訪問|限制)/i.test(q)) {
    return withPage("内容政策与隐私", "/policy", siteAgreementTerms.map(term => `- ${t(term)}`).join("\n"));
  }
  if (/(?:本站|站内|站內|山海知序).{0,8}工具|工具[与與]指南|(?:有哪些|什么|甚麼)工具|\bsite tools\b/i.test(q)) {
    return withPage("工具与指南", "/tools", tools.map(tool => `- ${link(t(tool.title),tool.href)} · ${t(tool.description)}`).join("\n"));
  }
}

type Reference = { title: string; excerpt: string; href: string };

export function assistantSiteEvidence(question: string, db: DatabaseSync, visibility: ContentVisibility) {
  const topic = siteTopic(question);
  const query = directorySearch(topic, false);
  if (!query.searchable || topic.length < 2) return [];
  const references: Reference[] = searchCatalog(question).slice(0, 2).map(tool => ({
    title: tool.title, excerpt: tool.description, href: tool.href,
  }));
  const [, area, id, key] = (siteReference(question) ?? "").split("/");
  if (area === "services") {
    const site = getSite(id, db, visibility);
    if (site) references.unshift({ title:site.name, href:siteHref(site.slug), excerpt:`${site.category_label}。${site.summary}\n${site.products ?? ""}` });
  }
  if (area === "observations") {
    const entry = publicEditorial(id, db, visibility);
    if (entry) references.unshift({ title:entry.title, href:observationHref(entry.slug), excerpt:`${entry.summary}\n${entry.body}` });
  }
  if (area === "products" && /^[1-9]\d{0,14}$/.test(id) && /^[a-f0-9]{32}$/.test(key ?? "")) {
    const site = getSiteById(Number(id), db, visibility);
    const price = site && getPublicProduct(db, site.id, key);
    if (price) references.unshift({ title:productName(price), href:productHref(price), excerpt:
      `${site.name} · ${price.currency} ${price.amount_minor / 10 ** (price.amount_scale ?? 2)} · ${price.period} · 记录日期 ${localDay(price.recorded_at)}。库存以商家页面为准。` });
  }
  const articles = publicEditorials(undefined, -1, db, visibility).map(entry => ({
    entry, score: query.score([{text:entry.title,weight:12},{text:entry.summary,weight:8},{text:entry.body,weight:4}]),
  })).filter(({score}) => score > 0).sort((a,b) => b.score - a.score).slice(0, 3);
  for (const {entry} of articles) references.push({ title: entry.title, href: observationHref(entry.slug),
    excerpt: `${entry.summary}\n${entry.body.split(/\n\s*\n/).find(paragraph => query.score([{text:paragraph,weight:4}])) ?? ""}` });
  if (topic.length <= 36 && !/(?:[账帳]号|密[码碼]|拒[付绝絕]|绑卡|綁卡|支付失[败敗]|[论論]文|作[业業]|[隐隱]私)/i.test(question)) {
    const {rows, priceMatches} = listSites({q:topic,lifecycle:"current",size:3,visibility}, db);
    for (const site of rows) {
      references.push({ title: site.name, href: siteHref(site.slug), excerpt: `${site.category_label}。${site.summary}\n${site.products ?? ""}` });
      const match = priceMatches.get(site.id);
      if (!match) continue;
      const price = latestPrices(publicPrices(site.id, db)).find(item => item.plan === match.plan && item.product_title === match.product_title);
      if (price) references.push({ title: productName(price), href: productHref(price), excerpt:
        `${site.name} · ${price.currency} ${price.amount_minor / 10 ** (price.amount_scale ?? 2)} · ${price.period} · 记录日期 ${localDay(price.recorded_at)}。库存以商家页面为准。` });
    }
  }
  return [...new Map(references.map(reference => [reference.href, reference])).values()].slice(0, 7).map(reference => ({ ...reference, title: visibility.filterText(reference.title).slice(0, 140),
    excerpt: visibility.filterText(reference.excerpt).slice(0, 430) }));
}
