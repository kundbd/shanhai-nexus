import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { all, one, transaction } from "./db";
import { reviewMerchantWithDeepSeek, type MerchantReviewDecision } from "./deepseek-merchant-review";
import { approveItems, candidate, publishBatch } from "./imports";
import {
  collectOfficialAvatar, inspectImportMerchant, merchantStorefrontObservations, saveMerchantAssets, type EnrichmentOptions,
} from "./merchant-enrichment";
import { refreshFailure, saveShopObservation } from "./refresh-discovery";
import { isStorefrontPlatform, storefrontIdentity } from "./storefront-identity";
import { isRetiredCategory, isRetiredNetworkSite } from "./taxonomy";
import type { ImportItem } from "./types";
import { websiteUrl } from "./validation";
import { audit } from "./write";

const actor = "DeepSeek 批量导入审核";
const archiveNote = "已归档。机场、VPN 与代理服务分类已下架。";
const leaseMs = 180_000;
const pending = "('queued','checking','retry')";
type Claimed = ImportItem & { token: string; attempts: number };
type State = "held" | "archived" | "published" | "duplicate" | "retry" | "superseded";
type Options = EnrichmentOptions & {
  review?: typeof reviewMerchantWithDeepSeek;
  evidenceUrl?: (item: number) => string | undefined;
};

export function queueImportReviews(db: DatabaseSync, throughId: number) {
  return transaction(db, () => {
    const items = all<{ id: number; state: ImportItem["state"]; category: string | null }>(db, `SELECT i.id,i.state,
      json_extract(i.payload,'$.category') category FROM import_items i
      WHERE i.id<=? AND i.state IN ('ready','approved') AND NOT EXISTS(SELECT 1 FROM import_item_reviews r WHERE r.item_id=i.id)
      ORDER BY i.id`, throughId);
    const insert = db.prepare("INSERT INTO import_item_reviews(item_id,state,note,updated_at) VALUES (?,?,?,?)");
    const stamp = new Date().toISOString();
    let queued = 0;
    let archived = 0;
    for (const item of items) {
      if (isRetiredCategory(item.category ?? "")) {
        insert.run(item.id, "archived", archiveNote, stamp);
        audit(db, actor, "archive", "import_items", item.id, { state: item.state }, { state: "archived", category: item.category });
        archived++;
      } else if (item.state === "ready") {
        insert.run(item.id, "queued", "等待 DeepSeek 审核。", stamp);
        queued++;
      }
    }
    return { queued, archived };
  });
}

export function importReviewProgress(db: DatabaseSync, throughId: number) {
  const states = all<{ state: string; count: number }>(db,
    "SELECT state,count(*) count FROM import_item_reviews WHERE item_id<=? GROUP BY state", throughId);
  const waiting = one<{ remaining: number; next: number | null }>(db,
    `SELECT count(*) remaining,min(available_at) next FROM import_item_reviews WHERE item_id<=? AND state IN ${pending}`, throughId)!;
  return { counts: Object.fromEntries(states.map(({ state, count }) => [state, count])), ...waiting };
}

function claim(db: DatabaseSync, throughId: number): Claimed | undefined {
  return transaction(db, () => {
    const now = Date.now();
    const stamp = new Date(now).toISOString();
    db.prepare(`UPDATE import_item_reviews SET state='superseded',token=NULL,approval_digest=NULL,note='已由其他审核流程处理。',updated_at=?
      WHERE item_id<=? AND state IN ${pending} AND NOT EXISTS
      (SELECT 1 FROM import_items i WHERE i.id=import_item_reviews.item_id AND i.state='ready')`).run(stamp, throughId);
    const row = one<ImportItem & { attempts: number }>(db, `SELECT i.*,r.attempts FROM import_item_reviews r
      JOIN import_items i ON i.id=r.item_id AND i.state='ready'
      WHERE r.item_id<=? AND r.state IN ${pending} AND r.available_at<=?
      ORDER BY r.item_id LIMIT 1`, throughId, now);
    if (!row) return;
    const token = randomUUID();
    db.prepare(`UPDATE import_item_reviews SET state='checking',attempts=attempts+1,available_at=?,token=?,
      note='正在核对商家的公开官网。',approval_digest=NULL,updated_at=? WHERE item_id=?`).run(now + leaseMs, token, stamp, row.id);
    return { ...row, token, attempts: row.attempts + 1 };
  });
}

function ownsCandidate(db: DatabaseSync, row: Claimed) {
  return !!one(db, `SELECT 1 FROM import_item_reviews r JOIN import_items i ON i.id=r.item_id
    WHERE i.id=? AND i.state='ready' AND i.payload=? AND i.message=? AND r.state='checking' AND r.token=?`,
    row.id, row.payload, row.message, row.token);
}

function finish(db: DatabaseSync, row: Claimed, state: State, note: string, evidence?: string, decision?: MerchantReviewDecision["decision"]) {
  const update = db.prepare(`UPDATE import_item_reviews SET state=?,available_at=?,token=NULL,note=?,evidence_url=?,
    model_decision=?,approval_digest=NULL,updated_at=? WHERE item_id=? AND token=?`).run(
    state, state === "retry" ? Date.now() + 10_000 * row.attempts : 0, note, evidence ?? null,
    decision ?? null, new Date().toISOString(), row.id, row.token);
  return update.changes ? { item: row.id, state } : undefined;
}

function settle(db: DatabaseSync, row: Claimed, state: State, note: string, evidence?: string, decision?: MerchantReviewDecision["decision"]) {
  return transaction(db, () => {
    if (!ownsCandidate(db, row)) return finish(db, row, "superseded", "资料已由其他审核流程处理。");
    if (state === "archived") audit(db, actor, "archive", "import_items", row.id, { state: row.state }, { state, evidence });
    return finish(db, row, state, note, evidence, decision);
  });
}

function existingMerchant(db: DatabaseSync, url: string) {
  const storefront = storefrontIdentity(url);
  const fields = "SELECT s.id,s.slug,s.category_slug FROM sites s";
  const suffix = "ORDER BY (s.publication='published') DESC,s.id LIMIT 1";
  type Existing = { id: number; slug: string; category_slug: string };
  return storefront
    ? one<Existing>(db, `${fields} JOIN merchant_storefronts f ON f.site_id=s.id WHERE f.storefront_key=? ${suffix}`, storefront.key)
    : one<Existing>(db, `${fields} JOIN site_domains d ON d.site_id=s.id WHERE d.registrable=? ${suffix}`, websiteUrl(url).registrable);
}

function recordDuplicate(db: DatabaseSync, row: Claimed, site: NonNullable<ReturnType<typeof existingMerchant>>) {
  if (isRetiredNetworkSite(site.category_slug, site.slug)) {
    audit(db, actor, "archive", "import_items", row.id, { state: row.state }, { state: "archived", site: site.id });
    return finish(db, row, "archived", archiveNote);
  }
  db.prepare("UPDATE import_items SET state='duplicate',site_id=?,message=? WHERE id=?")
    .run(site.id, "官网已关联现有档案。", row.id);
  audit(db, actor, "duplicate", "import_items", row.id, { state: row.state }, { state: "duplicate", site: site.id });
  return finish(db, row, "duplicate", "已关联现有商家档案。");
}

export async function reviewNextImport(db: DatabaseSync, throughId: number, options: Options = {}) {
  if (options.stop?.aborted) return;
  const review = options.review ?? reviewMerchantWithDeepSeek;
  if (!options.review && !process.env.DEEPSEEK_API_KEY?.trim()) throw new Error("未配置 DeepSeek 商家审核密钥");
  const row = claim(db, throughId);
  if (!row) return;

  let input: ReturnType<typeof candidate>["data"];
  try {
    const raw = JSON.parse(row.payload);
    if (typeof raw?.category === "string" && isRetiredCategory(raw.category)) {
      return settle(db, row, "archived", archiveNote);
    }
    input = candidate(raw).data;
  }
  catch { return settle(db, row, "held", "导入资料缺少有效的公开网址，待人工复核。"); }
  const original = websiteUrl(input.url);
  if (isStorefrontPlatform(original.domain) && !storefrontIdentity(input.url)) {
    return settle(db, row, "held", "平台首页缺少可识别的独立店铺链接，待人工复核。");
  }
  const registered = existingMerchant(db, input.url);
  if (registered) return transaction(db, () => ownsCandidate(db, row)
    ? recordDuplicate(db, row, registered) : finish(db, row, "superseded", "资料已由其他审核流程处理。"));

  let inspected: Awaited<ReturnType<typeof inspectImportMerchant>>;
  try {
    const preferred = websiteUrl(options.evidenceUrl?.(row.id) ?? input.url);
    const storefront = storefrontIdentity(input.url);
    if (preferred.registrable !== original.registrable ||
      storefrontIdentity(preferred.url)?.key !== storefront?.key) {
      return settle(db, row, "held", "补充来源与旧记录的官网或店铺身份不一致，待人工复核。");
    }
    inspected = await inspectImportMerchant(db, { name: input.name, website: preferred.url, category_slug: input.category }, options);
  }
  catch (error) {
    if (options.stop?.aborted) return settle(db, row, "retry", "审核已中断，可继续处理。");
    const { reason, state } = refreshFailure(error);
    if (row.attempts<2 && state==="unreachable") return settle(db, row, "retry", `公开官网暂未连接，稍后再试。 ${reason}`);
    return settle(db, row, "held", `公开官网暂缺可核对的证据。 ${reason}`);
  }
  if (inspected.retired) return settle(db, row, "archived", archiveNote);
  const { target, inspection } = inspected;
  const evidence = inspection?.evidence;
  if (!target || !inspection || !evidence) return settle(db, row, "held", "未取得能对应独立商家的公开商品或服务证据。");
  const publisher = { ...target, category_slug: evidence.category };

  let decision: MerchantReviewDecision;
  try {
    decision = await review({ name: target.name, website: evidence.url, category: evidence.category, text: evidence.text }, options.stop);
  } catch (error) {
    const status = error instanceof Error ? /^DeepSeek 商家审核 HTTP (\d{3})$/.exec(error.message)?.[1] : undefined;
    if (status && ["400","401","402","403","404"].includes(status)) {
      settle(db, row, "retry", `DeepSeek 商家审核 HTTP ${status}，可继续处理。`, evidence.url);
      throw error;
    }
    const retry = options.stop?.aborted || row.attempts < 3;
    return settle(db, row, retry ? "retry" : "held", retry
      ? "DeepSeek 请求未完成，稍后再试。" : "DeepSeek 请求多次未完成，待人工复核。", evidence.url);
  }
  if (decision.decision !== "approve") return settle(db, row, "held", "DeepSeek 认为官网证据需要人工复核。", evidence.url, "review");
  const avatar = await collectOfficialAvatar(db, publisher, inspection, options).catch(() => ({ avatar: null, reason: "官网图标暂时无法读取" }));
  if (options.stop?.aborted) return settle(db, row, "retry", "审核已中断，可继续处理。", evidence.url);
  try {
    return transaction(db, () => {
      if (!ownsCandidate(db, row)) return finish(db, row, "superseded", "资料已由其他审核流程处理。");
      const current = existingMerchant(db, publisher.website);
      if (current) return recordDuplicate(db, row, current);
      const stamp = new Date().toISOString();
      let siteId: number;
      let website = publisher.website;
      if (inspection.hosted) {
        const [offer] = merchantStorefrontObservations(publisher, inspection, stamp);
        if (!offer) return finish(db, row, "held", "平台店铺缺少可对应商品的公开人民币标价。", evidence.url, "approve");
        siteId = saveShopObservation(db, offer, undefined, actor).siteId;
        db.prepare(`UPDATE import_items SET state='published',site_id=?,checked_at=?,check_detail=?,reachability='reachable',
          final_url=?,message='' WHERE id=?`).run(siteId, stamp, decision.evidence, evidence.url, row.id);
        audit(db, actor, "publish", "import_items", row.id, { state: "ready" }, { state: "published", site: siteId });
      } else {
        const approved = candidate({
          url: publisher.website, name: publisher.name, category: publisher.category_slug, basis: "basic",
          source_kind: "official", source_url: evidence.url, source_title: "商家公开官网",
          snapshot_at: stamp.slice(0,10), excerpt: decision.evidence,
        });
        website = approved.data.url;
        const payload = JSON.stringify(approved.data);
        db.prepare(`UPDATE import_items SET payload=?,domain=?,registrable=?,normalized_name=?,checked_at=?,check_detail=?,
          reachability='reachable',final_url=?,message='' WHERE id=?`).run(
          payload, approved.domain, approved.registrable, approved.name, stamp, decision.evidence, evidence.url, row.id);
        db.prepare("UPDATE import_item_reviews SET model_decision='approve',approval_digest=? WHERE item_id=? AND token=?")
          .run(createHash("sha256").update(payload).digest("hex"), row.id, row.token);
        audit(db, actor, "review", "import_items", row.id, { payload: JSON.parse(row.payload), message: row.message }, { category: publisher.category_slug, evidence: evidence.url });
        if (approveItems(db, row.batch_id, [row.id], actor, true).count!==1 || publishBatch(db, row.batch_id, actor, [row.id], true)!==1) {
          throw new Error("导入校验未通过");
        }
        siteId = one<{ site_id: number }>(db, "SELECT site_id FROM import_items WHERE id=? AND state='published'", row.id)!.site_id;
      }
      const assets = saveMerchantAssets(db, { ...publisher, id: siteId, website }, inspection, avatar, stamp, actor);
      const icon = assets.hasAvatar ? "已收录店铺图标。" : "暂缺可用的官网图标。";
      return finish(db, row, "published", `DeepSeek 已批准并发布。核对公开报价 ${assets.checked} 项，${icon}`, evidence.url, "approve");
    });
  } catch {
    return settle(db, row, "held", "DeepSeek 已批准，候选与现有档案或发布校验有冲突，待人工复核。", evidence.url, "approve");
  }
}
