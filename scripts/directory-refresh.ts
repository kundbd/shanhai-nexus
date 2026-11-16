import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { directory } from "../lib/directory/db";
import { directoryRefreshStatus } from "../lib/directory/refresh-state";
import { runDirectoryRefresh } from "../lib/directory/run-refresh";

for (const file of [".env.local",".env"]) if (existsSync(file)) loadEnvFile(file);
const [command="--once",limitArg]=process.argv.slice(2);
const limit=limitArg==null?null:Number(limitArg);
if (!["--once","--watch","--status"].includes(command)||limit!==null&&(!Number.isInteger(limit)||limit<1||limit>250||command!=="--once")) {
  throw new Error("用法：directory:refresh -- --once [1–250] | --watch | --status");
}

async function main() {
  const db=directory();
  const controller=new AbortController();
  const stop=()=>controller.abort();
  process.once("SIGINT",stop);
  process.once("SIGTERM",stop);
  try {
    if (command==="--status") { console.log(JSON.stringify(directoryRefreshStatus(db),null,2));return; }
    if (command==="--watch"&&process.env.DIRECTORY_REFRESH_ENABLED==="0") {
      console.log("目录定时刷新已关闭");
      while (!controller.signal.aborted) await delay(30_000,undefined,{signal:controller.signal}).catch(()=>{});
      return;
    }
    while (!controller.signal.aborted) {
      try {
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
