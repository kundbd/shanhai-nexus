import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { all,one } from "../directory/db";
import type { ContentSurface,ViolationCategory } from "./policy";

const threeDays=72*60*60*1000;
const retryWindow=10*60*1000;

export type Penalty={id:number;strike:number;category:ViolationCategory;surface:ContentSurface;created_at:number;muted_until:number|null};

export function latestPenalty(db:DatabaseSync,account:number) {
  return one<Penalty>(db,"SELECT id,strike,category,surface,created_at,muted_until FROM member_content_penalties WHERE account_id=? ORDER BY strike DESC LIMIT 1",account);
}

export function penaltyActive(penalty:Penalty|undefined,time=Date.now()) {
  return (penalty?.muted_until??0)>time;
}

export function writingMuted(db:DatabaseSync,account:number,time=Date.now()) {
  return penaltyActive(latestPenalty(db,account),time);
}

// Call within the same write transaction as the decision to withdraw content.
export function recordContentPenalty(db:DatabaseSync,account:number,surface:ContentSurface,context:string,body:string,category:ViolationCategory,time=Date.now()) {
  const fingerprint=createHash("sha256").update(JSON.stringify([surface,context,body])).digest("hex");
  const prior=one<Penalty>(db,`SELECT id,strike,category,surface,created_at,muted_until
    FROM member_content_penalties WHERE account_id=? AND fingerprint=? AND created_at>=? ORDER BY created_at DESC LIMIT 1`,
    account,fingerprint,time-retryWindow);
  if (prior) return prior;
  const last=latestPenalty(db,account);
  // Parallel requests can finish after the account has already been muted.
  if (last?.muted_until&&last.muted_until>time) return last;
  const strike=(last?.strike??0)+1;
  const mutedUntil=strike>=2?time+threeDays:null;
  const id=Number(db.prepare(`INSERT INTO member_content_penalties(account_id,surface,fingerprint,category,strike,created_at,muted_until)
    VALUES (?,?,?,?,?,?,?)`).run(account,surface,fingerprint,category,strike,time,mutedUntil).lastInsertRowid);
  return {id,strike,category,surface,created_at:time,muted_until:mutedUntil};
}

export function recentPenalties(db:DatabaseSync) {
  return all<Penalty&{username:string}>(db,`SELECT p.id,p.strike,p.category,p.surface,p.created_at,p.muted_until,a.username
    FROM member_content_penalties p JOIN member_accounts a ON a.id=p.account_id ORDER BY p.id DESC LIMIT 30`);
}
