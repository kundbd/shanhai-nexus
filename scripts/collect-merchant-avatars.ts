import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { all,directory } from "../lib/directory/db";
import { avatarCollector } from "../lib/directory/merchant-avatar-collection";
import { saveMerchantAvatar,type AvatarTarget } from "../lib/directory/merchant-avatar";
import { parseProxy } from "../lib/directory/network-transport";

for (const file of [".env.local",".env"]) if (existsSync(file)) loadEnvFile(file);
const options=new URLSearchParams(process.argv.slice(2).map(value=>value.replace(/^--/,"")).join("&"));
function integer(name:string,fallback:number,min:number,max:number) {
  const value=Number(options.get(name)??fallback);
  if (!Number.isInteger(value)||value<min||value>max) throw new Error(`--${name} 应在 ${min} 到 ${max} 之间`);
  return value;
}
const workers=integer("workers",16,1,28);
const limit=integer("limit",2000,1,20_000);
const maxAge=options.has("retry-missing")?0:14;
const before=new Date(Date.now()-maxAge*86400000).toISOString();
async function main() {
  const db=directory();
  let nextGlobal=0;
  const nextOrigin=new Map<string,number>();
  const collect=avatarCollector(async(url,signal)=>{
    const current=Date.now();
    const hostSlot=Math.max(current,nextOrigin.get(url.hostname)??0);
    nextOrigin.set(url.hostname,hostSlot+680);
    if (hostSlot>current) await delay(hostSlot-current,undefined,{signal});
    const globalSlot=Math.max(Date.now(),nextGlobal);
    nextGlobal=globalSlot+55;
    if (globalSlot>Date.now()) await delay(globalSlot-Date.now(),undefined,{signal});
  },options.has("proxy")?parseProxy(process.env.MERCHANT_PROXY):undefined);

  try {
    const targets=all<AvatarTarget>(db,`SELECT s.id,s.website,s.name,s.slug,
        NOT EXISTS(SELECT 1 FROM site_domains d WHERE d.site_id=s.id AND d.kind='primary') AS hosted_storefront
      FROM sites s LEFT JOIN merchant_avatars a ON a.site_id=s.id AND a.website=s.website
    WHERE s.publication='published' AND (a.site_id IS NULL OR (a.image IS NULL AND
      (a.checked_at<? OR (?=1 AND a.reason LIKE '%timeout%'
        AND EXISTS(SELECT 1 FROM site_domains d WHERE d.site_id=s.id AND d.kind='primary')))))
        AND (? IS NULL OR s.slug=?)
    ORDER BY s.id LIMIT ?`,before,Number(options.has("retry-network")),options.get("slug"),options.get("slug"),limit);
    const groups=new Map<string,AvatarTarget[]>();
    for (const row of targets) {
      let host=row.slug;
      try { host=new URL(row.website).hostname.replace(/^www\./,""); } catch { /* Invalid URLs are recorded by the collector. */ }
      const group=groups.get(host)??[];
      group.push(row);
      groups.set(host,group);
    }
    const buckets=[...groups.values()].sort((a,b)=>b.length-a.length);
    const active=new Set<AvatarTarget[]>();
    let processed=0,saved=0;
    const reasons:Record<string,number>=Object.create(null);
    const take=()=>buckets.find(rows=>rows.length&&!active.has(rows));
    async function worker() {
      for (let rows=take();rows;rows=take()) {
        const row=rows.shift()!;
        active.add(rows);
        try {
          const {avatar,reason}=await collect(row).catch((error:unknown)=>({avatar:null,reason:(error instanceof Error?error.message:"读取失败").slice(0,180)}));
          saveMerchantAvatar(db,row,avatar,reason,new Date().toISOString());
          processed++;
          if (avatar) saved++;
          else reasons[reason]=(reasons[reason]??0)+1;
          if (processed%150===0) console.log(JSON.stringify({processed,saved,total:targets.length}));
        } finally { active.delete(rows); }
      }
    }
    console.log(JSON.stringify({scheduled:targets.length,groups:groups.size,workers}));
    await Promise.all(Array.from({length:workers},worker));
    console.log(JSON.stringify({processed,saved,placeholders:processed-saved,reasons:Object.entries(reasons).sort(([,a],[,b])=>b-a).slice(0,18)}));
  } finally { db.close(); }
}

void main().catch(error=>{ console.error(error); process.exitCode=1; });
