import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getGuide,getTool } from "../catalog";
import { communityPostVisitors,recordCommunityPostVisitor } from "../community/posts";
import { guideAllowed } from "../geo/catalog";
import { siteVisibility, type ContentVisibility } from "../geo/visibility";
import { isTrafficPath,isTrafficVisitor,publicPageLabels,trafficPostId,trafficProduct } from "../traffic-path";
import { all,directory,one,transaction } from "./db";
import { getPublicProduct,productName } from "./products";
import { getCategory,publicEditorial } from "./read";
import { publicThread } from "./community";

export function trafficWindow(time:number) {
  const minute=Math.floor(time/60_000);
  return {minute,cutoff:minute-24*60};
}
const lastPruned=new WeakMap<DatabaseSync,number>();
// Different scopes cannot be joined by the stored hashes.
const hashVisitor=(scope:string,id:string)=>createHash("sha256").update(scope).update("\0").update(id).digest();

function trafficTitle(db:DatabaseSync,path:string,visibility?:ContentVisibility) {
  if (Object.hasOwn(publicPageLabels,path)) return publicPageLabels[path as keyof typeof publicPageLabels];
  const post=trafficPostId(path);
  if (post!==undefined) return communityPostVisitors(db,post)?`社区帖子 #${post}`:undefined;
  const product=trafficProduct(path);
  if (product) {
    const region=siteVisibility(visibility);
    if (visibility&&!one(db,`SELECT 1 FROM sites s WHERE s.id=? AND ${region.clause}`,product.siteId,...region.bindings)) return;
    const price=getPublicProduct(db,product.siteId,product.key);
    return price&&productName(price);
  }
  const [,section,slug]=path.split("/");
  if (section==="categories") return getCategory(slug,db,visibility)?.label;
  if (section==="observations") return publicEditorial(slug,db,visibility)?.title;
  if (section==="guides") {
    const guide=getGuide(slug);
    return guide&&(!visibility||guideAllowed(visibility,guide))?guide.title:undefined;
  }
  if (section==="tools") return getTool(slug)?.title;
  if (section==="services") {
    const region=siteVisibility(visibility);
    return one<{name:string}>(db,`SELECT name FROM sites s WHERE slug=? AND publication='published' AND ${region.clause}`,slug,...region.bindings)?.name;
  }
  if (section==="community" && Number.isSafeInteger(Number(slug))) {
    const thread=publicThread(Number(slug),db,visibility);
    return thread && `${thread.site_name}的讨论`;
  }
}

export function recordPageVisitor(db:DatabaseSync,path:string,visitor:string,time=Date.now(),visibility?:ContentVisibility) {
  if (!isTrafficPath(path)||!isTrafficVisitor(visitor)) return false;
  const {minute,cutoff}=trafficWindow(time);
  const recorded=transaction(db,()=>{
    const id=trafficPostId(path);
    const result=id===undefined?Boolean(trafficTitle(db,path,visibility)):recordCommunityPostVisitor(db,id,hashVisitor(`post:${id}`,visitor));
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
