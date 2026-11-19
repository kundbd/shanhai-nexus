import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { directory } from "../lib/directory/db";
import { enrichPublishedMerchant } from "../lib/directory/merchant-enrichment";
import { reviewNextMerchantSubmission } from "../lib/directory/merchant-submission-review";
import { parseProxy } from "../lib/directory/network-transport";
import { refreshAccessRule } from "../lib/directory/refresh-discovery";
import { directoryRefreshStatus } from "../lib/directory/refresh-state";
import { checkStorefrontQuotes,runDirectoryRefresh } from "../lib/directory/run-refresh";
import { refreshStorefrontFeed } from "../lib/directory/storefront-feed";
import { websiteVisit } from "../lib/directory/website-check";

for (const file of [".env.local",".env"]) if (existsSync(file)) loadEnvFile(file);
const [command="--once",limitArg,plan=""]=process.argv.slice(2);
const enrichment=command==="--enrich-merchant";
const limit=limitArg==null||enrichment?null:Number(limitArg);
const maxLimit=command==="--check-storefronts"?30:command==="--once"?250:0;
if (!["--once","--watch","--status","--check-storefronts","--refresh-price-feed","--enrich-merchant"].includes(command)||
    (limit!==null&&(!Number.isInteger(limit)||limit<1||limit>maxLimit))||
    (enrichment&&(!limitArg||!/^[-a-z\d]{1,90}$/.test(limitArg)||plan))) {
  throw new Error("用法：directory:refresh -- --once [1–250] | --watch | --status | --check-storefronts [1–30] [商品关键词] | --refresh-price-feed | --enrich-merchant 商家slug");
}

async function main() {
  const db=directory();
  const controller=new AbortController();
  const stop=()=>controller.abort();
  process.once("SIGINT",stop);
  process.once("SIGTERM",stop);
  try {
    if (command==="--status") { console.log(JSON.stringify(directoryRefreshStatus(db),null,2));return; }
    if (enrichment) {
      console.log(JSON.stringify(await enrichPublishedMerchant(db,limitArg,{stop:controller.signal})));
      return;
    }
    if (command==="--refresh-price-feed") {
      const restricted=refreshAccessRule(db);
      const visit=websiteVisit(parseProxy(process.env.MERCHANT_PROXY),{compressed:true});
      const report=await refreshStorefrontFeed(db,(url,signal,bytes)=>{
        if (restricted(url.href)) throw new Error("来源限制，暂停读取公开快照");
        return visit(url,AbortSignal.any([signal,controller.signal]),bytes);
      });
      console.log(JSON.stringify(report));
      if (report.state==="unavailable") process.exitCode=1;
      return;
    }
    if (command==="--check-storefronts") {
      console.log(JSON.stringify(await checkStorefrontQuotes(db,limit??12,plan,{signal:controller.signal}),null,2));
      return;
    }
    if (command==="--watch"&&process.env.DIRECTORY_REFRESH_ENABLED==="0") {
      console.log("目录定时刷新已关闭");
      while (!controller.signal.aborted) await delay(30_000,undefined,{signal:controller.signal}).catch(()=>{});
      return;
    }
    while (!controller.signal.aborted) {
      try {
        const reviewed=await reviewNextMerchantSubmission(db,{stop:controller.signal});
        if (reviewed) console.log(JSON.stringify(reviewed));
        if (controller.signal.aborted) break;
        const report=await runDirectoryRefresh(db,{batch:limit??120,signal:controller.signal});
        if (command!=="--watch"||report.claimed) console.log(JSON.stringify(report));
        if (command==="--once"&&(limit!==null||!report.claimed||report.latest?.finishedAt||report.latest?.error)) break;
        const milliseconds=report.claimed&&!report.latest?.finishedAt&&!report.latest?.error?700:30_000;
        await delay(milliseconds,undefined,{signal:controller.signal}).catch(()=>{});
      } catch {
        console.error("目录维护任务暂未完成。请检查数据库、代理或网络配置。");
        if (command!=="--watch") {process.exitCode=1;break;}
        await delay(30_000,undefined,{signal:controller.signal}).catch(()=>{});
      }
    }
  } finally {
    process.off("SIGINT",stop);
    process.off("SIGTERM",stop);
    db.close();
  }
}

void main().catch(()=>{
  console.error("刷新任务未启动。请检查本地配置及数据库迁移。");
  process.exitCode=1;
});
