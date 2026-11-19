import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getGuide,getTool } from "../catalog";
import { communityPostVisitors,recordCommunityPostVisitor } from "../community/posts";
import { isTrafficPath,isTrafficVisitor,publicPageLabels,trafficPostId,trafficProduct } from "../traffic-path";
import { all,directory,one,transaction } from "./db";
import { getPublicProduct,productName } from "./products";
import { getCategory,publicEditorial } from "./read";

export function trafficWindow(time:number) {
  const minute=Math.floor(time/60_000);
  return {minute,cutoff:minute-24*60};
}
const lastPruned=new WeakMap<DatabaseSync,number>();
// Different scopes cannot be joined by the stored hashes.
const hashVisitor=(scope:string,id:string)=>createHash("sha256").update(scope).update("\0").update(id).digest();

function trafficTitle(db:DatabaseSync,path:string) {
  if (Object.hasOwn(publicPageLabels,path)) return publicPageLabels[path as keyof typeof publicPageLabels];
  const post=trafficPostId(path);
  if (post!==undefined) return communityPostVisitors(db,post)?`社区帖子 #${post}`:undefined;
  const product=trafficProduct(path);
  if (product) {
    const price=getPublicProduct(db,product.siteId,product.key);
    return price&&productName(price);
  }
  const [,section,slug]=path.split("/");
  if (section==="categories") return getCategory(slug,db)?.label;
  if (section==="observations") return publicEditorial(slug,db)?.title;
  if (section==="guides") return getGuide(slug)?.title;
  if (section==="tools") return getTool(slug)?.title;
  if (section==="services") return one<{name:string}>(db,"SELECT name FROM sites WHERE slug=? AND publication='published'",slug)?.name;
  if (section==="community" && Number.isSafeInteger(Number(slug))) {
    const thread=one<{name:string}>(db,`SELECT s.name FROM user_reviews r JOIN sites s ON s.id=r.site_id
      WHERE r.id=? AND r.thread_id IS NULL AND r.body<>'' AND r.moderation='accepted' AND s.publication='published'`,Number(slug));
    return thread && `${thread.name}的讨论`;
  }
}

export function recordPageVisitor(db:DatabaseSync,path:string,visitor:string,time=Date.now()) {
  if (!isTrafficPath(path)||!isTrafficVisitor(visitor)) return false;
  const {minute,cutoff}=trafficWindow(time);
  const recorded=transaction(db,()=>{
    const id=trafficPostId(path);
    const result=id===undefined?Boolean(trafficTitle(db,path)):recordCommunityPostVisitor(db,id,hashVisitor(`post:${id}`,visitor));
    if(!result)return false;
    const latest=db.prepare(`INSERT INTO traffic_visitors(page,visitor_hash,last_seen) VALUES (?,?,?)
      ON CONFLICT(page,visitor_hash) DO UPDATE SET last_seen=excluded.last_seen
      WHERE excluded.last_seen>traffic_visitors.last_seen`);
    const pageHash=hashVisitor(`page:${path}`,visitor);
    latest.run("",hashVisitor("site",visitor),minute);
    latest.run(path,pageHash,minute);
    if (path.startsWith("/services/")||path.startsWith("/products/")) {
      db.prepare("INSERT OR IGNORE INTO ranking_pages(page) VALUES (?)").run(path);
      db.prepare(`INSERT OR IGNORE INTO ranking_visitors(page_id,visitor_hash) SELECT id,? FROM ranking_pages WHERE page=?`).run(pageHash,path);
    }
    if(lastPruned.get(db)!==minute)db.prepare("DELETE FROM traffic_visitors WHERE last_seen<=?").run(cutoff);
    return result;
  });
  if(recorded)lastPruned.set(db,minute);
  return recorded;
}

export function trafficReport(db=directory(),time=Date.now()) {
  const {minute,cutoff}=trafficWindow(time);
  const total=one<{n:number}>(db,"SELECT count(*) n FROM traffic_visitors WHERE page='' AND last_seen>? AND last_seen<=?",cutoff,minute)!.n;
  const rows=all<{page:string;visitors:number}>(db,`SELECT page,count(*) visitors FROM traffic_visitors
    WHERE page<>'' AND last_seen>? AND last_seen<=? GROUP BY page ORDER BY visitors DESC,page ASC LIMIT 15`,cutoff,minute);
  return {asOf:time,total,pages:rows.map(({page,visitors})=>({page,visitors,title:trafficTitle(db,page)}))};
}
