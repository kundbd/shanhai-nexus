import { readFileSync } from "node:fs";
import { directory } from "../lib/directory/db";
import { importRelayPricing } from "../lib/directory/relay-price-import";

const file=process.argv[2];
if (!file) throw new Error("请提供已核对的 AI 中转报价 JSON 文件。");
const batch=JSON.parse(readFileSync(file,"utf8")) as Parameters<typeof importRelayPricing>[1];
const db=directory();
try { console.log(JSON.stringify(importRelayPricing(db,batch))); }
finally { db.close(); }
