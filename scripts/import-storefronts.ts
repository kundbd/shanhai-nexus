import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDirectory } from "../lib/directory/db";
import { importStorefronts,type StorefrontObservation } from "../lib/directory/storefront-import";

const [database, evidence] = process.argv.slice(2);
if (!database || !evidence) throw new Error("用法 npm run directory:storefronts -- <SQLite 路径> <观测记录 JSON 路径>");
const json = readFileSync(resolve(evidence),"utf8");
if (Buffer.byteLength(json)>40_000_000) throw new Error("观测记录超过 40 MB。");
const rows:StorefrontObservation[]=JSON.parse(json.replace(/^\ufeff/,""));
if (!Array.isArray(rows)||rows.length>50_000) throw new Error("导入文件须为 JSON 数组，每份最多 50,000 项观测。");
const db = openDirectory(resolve(database),false);
try {
  const items:ReturnType<typeof importStorefronts> = [];
  for (let index=0;index<rows.length;index+=5000) items.push(...importStorefronts(db,rows.slice(index,index+5000)));
  console.log(JSON.stringify(items,null,2));
  if (items.some(item=>"error" in item)) process.exitCode=1;
} finally { db.close(); }
