import assert from "node:assert/strict";
import test from "node:test";
import { adminOverview } from "../../lib/directory/admin-read";
import { one, openDirectory } from "../../lib/directory/db";
import { importReviewProgress, queueImportReviews, reviewNextImport } from "../../lib/directory/import-item-review";
import { approveItems, createImport, getBatch, holdCandidate, previewPage, reviseItem } from "../../lib/directory/imports";
import { publicPrices } from "../../lib/directory/read";
import type { Visit } from "../../lib/directory/website-check";

const website = "https://old-review-fixture.net/";
const name = "青橙卡店";
const title = "ChatGPT Plus 会员月卡";
const visit: Visit = async url => {
  assert.equal(url.origin, new URL(website).origin);
  const response = (body: string, contentType: string, status = 200) => ({ status, body, contentType, truncated: false });
  if (url.pathname === "/robots.txt") return response("User-agent: *\nAllow: /api/v1/public/\n", "text/plain");
  if (url.pathname === "/") return response('<div id="app"></div><script type="module" src="/assets/index.js"></script>', "text/html");
  if (url.pathname === "/api/v1/public/config") return response(JSON.stringify({
    status_code: 0, data: { brand: { site_name: name, site_icon: "/icon.png", site_url: website }, currency: "CNY", storefront_template: "classic" },
  }), "application/json");
  if (url.pathname === "/api/v1/public/products") return response(JSON.stringify({
    status_code: 0, pagination: { total_page: 1 }, data: [{ title, price_amount: "28.00", stock_status: "in_stock" }],
  }), "application/json");
  return response("not found", "text/plain", 404);
};
const reviewOptions: NonNullable<Parameters<typeof reviewNextImport>[2]> = {
  visit,
  collectAvatar: async () => ({
    avatar: { sourceUrl: website + "icon.png", contentType: "image/webp", image: Buffer.from("fixture avatar") },
    reason: "公开店铺图标",
  }),
  review: async input => {
    assert.equal(input.name, name);
    assert.equal(input.website, website);
    assert.ok(input.text.includes(title));
    return { decision: "approve", evidence: title };
  },
};

test("legacy imports are archived by category or published exactly once with source, quote and avatar", async () => {
  using db = openDirectory(":memory:", false);
  const batch = createImport(db, JSON.stringify([
    { url: "https://retired-import-fixture.net/", name: "归档网络样本", category: "vpn" },
    { url: website, name, category: "ai-card" },
  ]), "json", "tester");
  const [obsolete, merchant] = getBatch(batch, db);
  holdCandidate(db, merchant.id, "旧版核对暂缓", "tester");
  assert.deepEqual(queueImportReviews(db, merchant.id), { queued: 1, archived: 1 });
  assert.equal(adminOverview(db).imports, 1);
  assert.equal(previewPage(db, batch, "archived", 1).rows[0].id, obsolete.id);
  assert.equal(previewPage(db, batch, "ready", 1).rows.length, 1);
  assert.equal(approveItems(db, batch, [obsolete.id], "tester").count, 0);
  assert.throws(() => reviseItem(db, obsolete.id, obsolete.payload, "tester", false), /已归档/);

  const [published, concurrent] = await Promise.all([
    reviewNextImport(db, merchant.id, reviewOptions), reviewNextImport(db, merchant.id, reviewOptions),
  ]);
  assert.equal(concurrent, undefined);
  assert.deepEqual(published, { item: merchant.id, state: "published" });
  const saved = getBatch(batch, db)[1];
  assert.equal(saved.state, "published");
  assert.equal(saved.final_url, website);
  assert.deepEqual(publicPrices(saved.site_id!, db).map(price => price.amount_minor), [2800]);
  assert.ok(one(db, "SELECT 1 FROM merchant_avatars WHERE site_id=? AND digest IS NOT NULL", saved.site_id));
  assert.equal(adminOverview(db).imports, 0);
  assert.deepEqual(queueImportReviews(db, merchant.id), { queued: 0, archived: 0 });
  assert.equal(importReviewProgress(db, merchant.id).remaining, 0);
});

test("legacy import review gives a concurrent editor the final decision and saves provider retries", async () => {
  using db = openDirectory(":memory:", false);
  const batch = createImport(db, JSON.stringify([{ url: website, name, category: "ai-card" }]), "json", "tester");
  const [item] = getBatch(batch, db);
  queueImportReviews(db, item.id);
  await assert.rejects(reviewNextImport(db, item.id, { ...reviewOptions, review: async () => {
    throw new Error("DeepSeek 商家审核 HTTP 402");
  } }), /HTTP 402/);
  assert.equal(importReviewProgress(db, item.id).counts.retry, 1);
  db.prepare("UPDATE import_item_reviews SET available_at=0 WHERE item_id=?").run(item.id);
  const completed = await reviewNextImport(db, item.id, { ...reviewOptions, review: async () => {
    holdCandidate(db, item.id, "管理员保留待审", "tester");
    return { decision: "approve", evidence: title };
  } });
  assert.equal(completed?.state, "superseded");
  assert.equal(importReviewProgress(db, item.id).remaining, 0);
  assert.equal(getBatch(batch, db)[0].site_id, null);
  assert.match(getBatch(batch, db)[0].message, /管理员保留待审/);
});

test("legacy import review takes the official brand from a titled API storefront", async () => {
  using db = openDirectory(":memory:", false);
  const url = "https://figrouter-fixture.net/";
  const batch = createImport(db, JSON.stringify([{ url, name: "Run AI with an API", category: "ai-relay" }]), "json", "tester");
  const [item] = getBatch(batch, db);
  queueImportReviews(db, item.id);
  const reviewedPage = url + "pricing";
  const result = await reviewNextImport(db, item.id, {
    ...reviewOptions,
    evidenceUrl: () => reviewedPage,
    visit: async ({ pathname }) => pathname === "/robots.txt"
      ? { status: 404, body: "", contentType: "text/plain", truncated: false }
      : { status: 200, body: '<title>FigRouter Fixture | Run AI with an API</title><h1>FigRouter Fixture</h1><h2>AI API gateway</h2><p>We offer a multi-model API with OpenAI and Claude. Pricing $5 per month.</p><a href="/pricing">Pricing</a><a href="/signup">Get started</a>', contentType: "text/html", truncated: false },
    review: async input => {
      assert.equal(input.name, "FigRouter Fixture");
      assert.equal(input.website, reviewedPage);
      return { decision: "approve", evidence: "AI API gateway" };
    },
  });
  assert.equal(result?.state, "published");
  assert.equal(one<{ name: string }>(db, "SELECT name FROM sites WHERE id=?", getBatch(batch, db)[0].site_id)?.name, "FigRouter Fixture");
});
