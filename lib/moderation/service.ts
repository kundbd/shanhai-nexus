import type { DatabaseSync } from "node:sqlite";
import { one,transaction } from "../directory/db";
import { reviewBlockedWords } from "../directory/reviews";
import { deepSeekModeration,moderationConfig } from "./provider";
import type { Assessment,ContentSurface } from "./policy";

export async function screenContent(db:DatabaseSync,account:number|null,surface:ContentSurface,body:string):Promise<Assessment|undefined> {
  const config=moderationConfig();
  if (!config.enabled||!body) return undefined;
  if (!config.key) return {decision:"review"};
  const timestamp=Date.now();
  const configured=Number(process.env.DSH_MODERATION_DAILY_LIMIT??120);
  const daily=Number.isSafeInteger(configured)&&configured>=0&&configured<=500?configured:120;
  const startOfDay=Math.floor(timestamp/86_400_000)*86_400_000;
  const id=transaction(db,()=>{
    const usage=one<{total:number;personal:number;running:number}>(db,`SELECT count(*) FILTER (WHERE started_at>=?) total,
      count(*) FILTER (WHERE account_id=? AND started_at>=?) personal,
      count(*) FILTER (WHERE status='running' AND started_at>?) running
      FROM content_ai_requests WHERE started_at>=?`,startOfDay,account,startOfDay,timestamp-15_000,Math.min(startOfDay,timestamp-15_000))!;
    if (!daily||usage.total>=daily||(account!==null&&usage.personal>=30)||usage.running>=3) return undefined;
    return Number(db.prepare("INSERT INTO content_ai_requests(account_id,surface,status,started_at) VALUES (?,?,'running',?)")
      .run(account,surface,timestamp).lastInsertRowid);
  });
  if (!id) return {decision:"review"};
  let result:Assessment={decision:"review"};
  let status="error";
  try {
    const blockedWords=reviewBlockedWords(db).map(({word})=>word);
    result=await deepSeekModeration(body,config,fetch,blockedWords);
    status=result.decision==="allow"?"allowed":result.decision;
  } catch { /* Service failures hold content for an editor and never create a penalty. */ }
  db.prepare("UPDATE content_ai_requests SET status=? WHERE id=?").run(status,id);
  return result;
}
