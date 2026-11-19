import { setTimeout as delay } from "node:timers/promises";
import { directory } from "../lib/directory/db";
import { importReviewProgress, queueImportReviews, reviewNextImport } from "../lib/directory/import-item-review";
import { limitedBacklogVisit } from "../lib/directory/merchant-lead-review";
import { parseProxy } from "../lib/directory/network-transport";
import { websiteVisit } from "../lib/directory/website-check";

const throughId = Number(process.argv[2]);
if (!Number.isSafeInteger(throughId) || throughId < 1 || process.argv.length !== 3) {
  throw new Error("用法：tsx scripts/review-import-items.ts <该批待审核记录的最大 ID>");
}

async function main() {
  const db = directory();
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    console.log(JSON.stringify({ phase: "queued", ...queueImportReviews(db, throughId) }));
    if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new Error("未配置 DeepSeek 商家审核密钥");
    const visit = limitedBacklogVisit(websiteVisit(parseProxy(process.env.MERCHANT_PROXY), { compressed: true }), 12, 1000);
    let completed = 0;
    async function processQueue() {
      while (!controller.signal.aborted) {
        const result = await reviewNextImport(db, throughId, { visit, stop: controller.signal });
        if (!result) return;
        if (result.state !== "retry" && ++completed % 25 === 0) {
          console.log(JSON.stringify({ phase: "progress", ...importReviewProgress(db, throughId) }));
        }
      }
    }
    while (!controller.signal.aborted) {
      const batch = await Promise.allSettled(Array.from({ length: 12 }, async () => {
        try { await processQueue(); }
        catch (error) { controller.abort(); throw error; }
      }));
      const failure = batch.find(result => result.status === "rejected");
      if (failure) throw failure.reason;
      const summary = importReviewProgress(db, throughId);
      if (!summary.remaining) {
        console.log(JSON.stringify({ phase: "finished", ...summary }));
        return;
      }
      const wait = Math.max(250, Math.min(10_000, (summary.next ?? Date.now()) - Date.now()));
      await delay(wait, undefined, { signal: controller.signal }).catch(() => {});
    }
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    db.close();
  }
}

void main().catch(error => {
  const message = error instanceof Error ? error.message : "";
  console.error(/^(?:未配置 DeepSeek 商家审核密钥|DeepSeek 商家审核 HTTP \d{3})$/.test(message) ? message : "旧批量导入审核暂停，可从已保存的进度继续。");
  process.exitCode = 1;
});
