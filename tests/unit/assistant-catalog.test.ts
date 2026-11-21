import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantCatalogIntent, assistantCatalogReply } from "@/lib/assistant/catalog";
import { assistantCatalogHref } from "@/lib/assistant/protocol";
import { assistantSiteEvidence, assistantSiteReply } from "@/lib/assistant/site-content";
import { writeCommunityPost } from "@/lib/community/posts";
import { openDirectory } from "@/lib/directory/db";
import { publicEditorials } from "@/lib/directory/read";
import { importRelayPricing } from "@/lib/directory/relay-price-import";
import { saveObservedStorefrontAvailability } from "@/lib/directory/storefront-availability";
import { importStorefronts, type StorefrontObservation } from "@/lib/directory/storefront-import";
import { saveVisibility } from "@/lib/geo/admin";
import { makeAudience } from "@/lib/geo/policy";
import { loadVisibility } from "@/lib/geo/visibility";

test("assistant queries comparable quotes and only provides public links for the current region", () => {
  using db = openDirectory(":memory:");
  const observedAt = "2026-11-20T17:00:00.000Z";
  const now = Date.parse("2026-11-20T18:00:00.000Z");
  function add(name: string, host: string, plan: string, price: number, availability: "available" | "unavailable" = "available", period = "1个月") {
    const observation: StorefrontObservation = { name, category: "ai-topup", website: `https://${host}/`, sourceUrl: `https://${host}/product/plus`,
      observedAt, offers: [{ plan, cnyMinor: price, period, availability }] };
    const [result] = importStorefronts(db, [observation]);
    if ("error" in result) assert.fail(result.error);
    saveObservedStorefrontAvailability(db, result.siteId, observation);
    return result;
  }
  const poster = add("报价甲", "quote-assistant-a.net", "ChatGPT Plus 月卡代充", 8500);
  add("报价乙", "quote-assistant-b.net", "ChatGPT Plus 月卡代充", 9100);
  add("报价丙", "quote-assistant-c.net", "ChatGPT Plus 月卡成品号", 5500);
  add("已售罄测试", "quote-assistant-gone.net", "ChatGPT Plus 月卡代充", 1000, "unavailable");
  add("年付测试", "quote-assistant-annual.net", "ChatGPT Plus 年卡代充", 4300, "available", "12个月");
  const restricted = add("地区广告测试", "quote-assistant-hidden.net", "ChatGPT Plus 月卡代充", 2000);
  saveVisibility(db, { kind: "site", key: restricted.slug, mode: "overseas" }, "fixture");
  const reply = (question: string, country = "CN", clock = now) => {
    const intent = assistantCatalogIntent(question);
    assert.ok(intent);
    return assistantCatalogReply(intent, db, loadVisibility(db, makeAudience(country)), "zh-CN", clock);
  };
  const price = reply("今天最偏的的gptplus是哪一家直接给链接");
  assert.match(price.text, /截至 2026-11-21，ChatGPT Plus · 月付/);
  assert.match(price.text, /代充.+85\.00.+报价甲/);
  assert.match(price.text, /成品号.+55\.00.+报价丙/);
  assert.doesNotMatch(price.text, /已售罄测试|年付测试|报价乙|地区广告测试/);
  assert.ok(price.links.includes(`/services/${poster.slug}#prices`));
  assert.ok(price.links.includes("https://quote-assistant-a.net/product/plus"));
  assert.ok(price.links.every(href => assistantCatalogHref(href) === href));
  assert.match(reply("最便宜 ChatGPT Plus 年付代充").text, /43\.00.+年付测试/);
  assert.match(reply("GPT Plus 代充最高价格").text, /91\.00.+报价乙/);
  assert.match(reply("ChatGPT Plus 代充最低价，只看今天核对", "CN", now + 24 * 60 * 60_000).text, /今天暂无可比报价/);
  assert.match(reply("gptplus 月付代充最便宜", "HK").text, /20\.00.+地区广告测试/);
  assert.match(reply("报价甲的官网是什么").text, /报价甲.+访问商家页面/);

  saveVisibility(db, { kind: "promotion", key: "https://quote-assistant-a.net/product/plus", mode: "overseas" }, "fixture");
  assert.ok(!reply("GPT Plus 代充最低价").links.includes("https://quote-assistant-a.net/product/plus"));
  const news = reply("山海观察最近有什么资讯？");
  assert.ok(news.links.some(href => href.startsWith("/observations/")));
  assert.equal(assistantCatalogIntent("绑卡被拒怎么排查？"), undefined);
  assert.equal(assistantCatalogIntent("帮我写一篇文章"), undefined);
  for (const url of ["javascript:alert(1)", "//example.com", "/admin", "https://example.net@secret.test/", "/services/../admin"]) {
    assert.equal(assistantCatalogHref(url), undefined);
  }
});

test("assistant looks up non-subscription price groups and public site sections", () => {
  using db = openDirectory(":memory:");
  const cn = loadVisibility(db, makeAudience("CN"));
  const now = Date.parse("2026-11-21T10:00:00.000Z");
  const plan = (name: string, slug: string, category: "vps" | "u-card", amount: string) => ({ name, slug,
    website: `https://${slug}.net/`, summary: name, category, sources: [{ url: `https://${slug}.net/prices`, note: "价目表",
      plans: [["公开套餐", "CNY", amount, "月付"] as const] }] });
  importRelayPricing(db, { observed: "2026-11-21", merchants: [
    plan("测试云", "assistant-vps-test", "vps", "19"), plan("测试 U 卡", "assistant-pay-test", "u-card", "4"),
    { name:"模型中转测试",slug:"assistant-relay-test",website:"https://assistant-relay-test.net/",summary:"模型价目",
      sources:[{url:"https://assistant-relay-test.net/models",note:"模型账单",rates:[
        ["DeepSeek V4 Pro","CNY","1.25","6.25"], ["DeepSeek V4 Pro 0813","CNY","8","9"],
      ]}] },
  ] });
  const quote = (question: string) => assistantCatalogReply(assistantCatalogIntent(question)!, db, cn, "zh-CN", now);
  assert.match(quote("哪家 VPS 月付最便宜？").text, /19\.00.+测试云/);
  assert.match(quote("U 卡有什么月费报价？").text, /4\.00.+测试 U 卡/);
  const relay = quote("DeepSeek V4 Pro 0813 API 每百万输入 Token 最低价");
  assert.match(relay.text, /DeepSeek V4 Pro 0813 · 每百万输入 Token.+8\.00/);
  assert.doesNotMatch(relay.text, /1\.25|输出 Token/);
  assert.equal(quote("中国大陆 VPN 最便宜的哪家？").links.length, 0);

  const owner = Number(db.prepare("INSERT INTO member_accounts(issuer,subject,username,created_at) VALUES ('fixture','assistant-posts','作者',?)").run(new Date(now).toISOString()).lastInsertRowid);
  const publicPost = writeCommunityPost(db, owner, "可见的公开体验", [], undefined, now);
  const pendingPost = writeCommunityPost(db, owner, "不公开的草稿内容", [], undefined, now+1);
  db.prepare("UPDATE community_posts SET ai_pending=0 WHERE id=?").run(publicPost.id);
  db.prepare("UPDATE community_posts SET ai_pending=1 WHERE id=?").run(pendingPost.id);
  const answer = (question: string) => assistantSiteReply(question, db, cn, "zh-CN", now)!;
  assert.ok(answer("社区最近有哪些帖子？").links.includes(`/community/posts/${publicPost.id}`));
  assert.doesNotMatch(answer("社区最近有哪些帖子？").text, /不公开的草稿内容/);
  assert.ok(answer("U 卡有哪些商家").links.includes("/services/assistant-pay-test"));
  assert.ok(answer("VPS 商品综合排行榜").links.includes("/rankings?group=vps&type=products&period=overall"));
  assert.match(answer("注册没收到验证码怎么办").text, /垃圾邮箱/);
  assert.equal(answer("站内有哪些工具？").links.length, 7);
  assert.ok(answer("隐私政策在哪里").links.includes("/policy#privacy"));

  saveVisibility(db, { kind:"site", key:"assistant-pay-test", mode:"overseas" }, "fixture");
  const restricted = loadVisibility(db, makeAudience("CN"));
  assert.ok(!assistantSiteEvidence("测试 U 卡",db,restricted).some(row => row.href === "/services/assistant-pay-test"));
  const article = publicEditorials(undefined, 1, db, cn)[0];
  assert.ok(article && assistantSiteEvidence(article.title,db,cn).some(row => row.href === `/observations/${article.slug}`));
});
