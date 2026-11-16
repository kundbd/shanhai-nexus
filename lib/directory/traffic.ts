import type { DatabaseSync } from "node:sqlite";
import { getGuide,getTool } from "../catalog";
import { communityPostViews,incrementCommunityPostViews } from "../community/posts";
import { isTrafficPath,publicPageLabels,trafficPostId } from "../traffic-path";
import { all,directory,one,transaction } from "./db";
import { getCategory,publicEditorial } from "./read";

const windowMinutes=24*60;
const bucket=(time:number)=>Math.floor(time/60_000);
const lastPruned=new WeakMap<DatabaseSync,number>();

function trafficTitle(db:DatabaseSync,path:string) {
  if (Object.hasOwn(publicPageLabels,path)) return publicPageLabels[path as keyof typeof publicPageLabels];
  const post=trafficPostId(path);
  if (post!==undefined) return communityPostViews(db,post)?`社区帖子 #${post}`:undefined;
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

export function recordPageView(db:DatabaseSync,path:string,time=Date.now()) {
  if (!isTrafficPath(path)) return false;
  const minute=bucket(time);
  const recorded=transaction(db,()=>{
    const id=trafficPostId(path);
    const result=id===undefined?Boolean(trafficTitle(db,path)):incrementCommunityPostViews(db,id);
    if(!result)return false;
    db.prepare(`INSERT INTO page_traffic(minute,page,views) VALUES (?,?,1)
      ON CONFLICT(minute,page) DO UPDATE SET views=views+1`).run(minute,path);
    if(lastPruned.get(db)!==minute)db.prepare("DELETE FROM page_traffic WHERE minute<=?").run(minute-windowMinutes);
    return result;
  });
  if(recorded)lastPruned.set(db,minute);
  return recorded;
}

export function trafficReport(db=directory(),time=Date.now()) {
  const minute=bucket(time);
  const rows=all<{page:string;views:number;total:number}>(db,`SELECT page,SUM(views) views,SUM(SUM(views)) OVER () total
    FROM page_traffic WHERE minute>? AND minute<=? GROUP BY page ORDER BY views DESC,page ASC LIMIT 15`,minute-windowMinutes,minute);
  return {asOf:time,total:rows[0]?.total??0,pages:rows.map(({page,views})=>({page,views,title:trafficTitle(db,page)}))};
}
