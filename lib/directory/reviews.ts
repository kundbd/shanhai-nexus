import type { DatabaseSync } from "node:sqlite";
import { all,one,transaction } from "./db";
import { choice,now,textValue } from "./validation";
import { audit } from "./write";
import { matchingReviewWords,mergeSuggestedReviewWords,parseReviewWords,reviewWordListLength,type ReviewWord } from "./review-word-rules";
import { firstWarning,mutedWriting,repeatedWarning,type Assessment } from "../moderation/policy";
import { recordContentPenalty,writingMuted } from "../moderation/store";

export const reviewModeration={pending:"待审核",accepted:"已公开",rejected:"已拒绝"} as const;
export type ReviewModeration=keyof typeof reviewModeration;
export const reviewPageSize=20;
export const reviewMessages={
  submitted:"已提交，审核通过后公开。",blocked:"评论包含屏蔽词，请修改后再提交。",
  duplicate:"你的账号已经评价过该商家。",limited:"提交过于频繁，请稍后再试。",
  invalid:"请填写评分或评论，评分须为 1 至 5 分，评论最多 1000 字。",unavailable:"暂时无法提交，请稍后重试。",
  reply_required:"请填写回复，最多 1000 字。",reply_duplicate:"你已经向这条留言提交过相同的回复。",
  reply_missing:"这条留言目前无法回复。请刷新页面。",
  ai_warning:firstWarning,ai_muted:repeatedWarning,muted:mutedWriting,
} as const;

export function discussionId(value?:string) {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const id=Number(value);
  return Number.isSafeInteger(id)?id:undefined;
}

export { sameOriginBrowserRequest as reviewRequestAllowed } from "../site-request";

export function reviewBlockedWords(db:DatabaseSync) {
  return all<ReviewWord>(db,"SELECT word,normalized FROM review_blocked_words ORDER BY word");
}

function canReply(db:DatabaseSync,site:number,thread:number,target:number) {
  return one(db,`SELECT 1 FROM user_reviews thread JOIN user_reviews target ON target.id=? AND target.site_id=thread.site_id
    AND target.moderation='accepted' AND (target.id=thread.id OR target.thread_id=thread.id)
    WHERE thread.id=? AND thread.site_id=? AND thread.thread_id IS NULL AND thread.body<>'' AND thread.moderation='accepted'`,target,thread,site);
}

type ReviewFields={score?:string;body?:string;reply_to?:string;thread?:string};
type ReviewOutcome=keyof typeof reviewMessages|"missing";
type Candidate={site:{id:number};target:number|undefined;thread:number|undefined;score:number|null;body:string};

export function prepareReview(db:DatabaseSync,slug:string,accountId:number,fields:ReviewFields,time=Date.now()):Candidate|ReviewOutcome {
  if(writingMuted(db,accountId,time))return "muted";
  const isReply=fields.thread!==undefined || fields.reply_to!==undefined;
  const target=discussionId(fields.reply_to);
  const thread=discussionId(fields.thread);
  if (isReply && (!target || !thread || fields.score)) return "reply_missing";
  if (fields.score && !/^[1-5]$/.test(fields.score)) return "invalid";
  const score=fields.score ? Number(fields.score) : null;
  let body:string;
  try { body=textValue(fields.body,1000,"评论",false); } catch { return isReply?"reply_required":"invalid"; }
  if (!score && !body) return isReply?"reply_required":"invalid";
  const cutoff=new Date(time-3_600_000).toISOString();
    const site=one<{id:number}>(db,"SELECT id FROM sites WHERE slug=? AND publication='published'",slug);
    if (!site) return "missing";
    if (thread && target && !canReply(db,site.id,thread,target)) return "reply_missing";
    if (body && matchingReviewWords(body,reviewBlockedWords(db)).length) return "blocked";
    if (target) {
      if (one(db,"SELECT 1 FROM user_reviews WHERE reply_to=? AND account_id=? AND body=?",target,accountId,body)) return "reply_duplicate";
    } else if (one(db,"SELECT 1 FROM user_reviews WHERE site_id=? AND thread_id IS NULL AND account_id=?",site.id,accountId)) return "duplicate";
    const limit=one<{total:number;personal:number}>(db,`SELECT
      (SELECT count(*) FROM user_reviews WHERE submitted_at>=?) total,
      (SELECT count(*) FROM user_reviews WHERE account_id=? AND submitted_at>=?) personal`,cutoff,accountId,cutoff)!;
    if (limit.personal>=8 || limit.total>=120) return "limited";
    return {site,score,body,thread,target};
}

export function submitReview(db:DatabaseSync,slug:string,accountId:number,fields:ReviewFields,time=Date.now(),assessment?:Assessment):ReviewOutcome {
  return transaction(db,()=>{
    const candidate=prepareReview(db,slug,accountId,fields,time);
    if(typeof candidate==="string")return candidate;
    const {site,score,body,thread,target}=candidate;
    if(assessment?.decision==="violation") {
      const penalty=recordContentPenalty(db,accountId,"review",`${site.id}:${target??"root"}`,body,assessment.category,time);
      return penalty.strike===1?"ai_warning":"ai_muted";
    }
    db.prepare("INSERT INTO user_reviews(site_id,score,body,submitted_at,moderation,account_id,thread_id,reply_to,ai_pending) VALUES (?,?,?,?,'pending',?,?,?,?)")
      .run(site.id,score,body,new Date(time).toISOString(),accountId,thread??null,target??null,assessment?.decision==="review"?1:0);
    return "submitted";
  });
}

export type ReviewSummary={average:number|null;ratings:number};

export function reviewSummaries(db:DatabaseSync,sites:readonly number[]) {
  if (!sites.length) return new Map<number,ReviewSummary>();
  const ids=sites.map(()=>"?").join(",");
  const rows=all<ReviewSummary & {site_id:number}>(db,`SELECT site_id,avg(score) average,count(score) ratings FROM user_reviews
    WHERE site_id IN (${ids}) AND thread_id IS NULL AND moderation='accepted' AND score IS NOT NULL GROUP BY site_id`,...sites);
  return new Map<number,ReviewSummary>(rows.map(({site_id,average,ratings})=>[site_id,{average,ratings}]));
}

export function reviewSummary(db:DatabaseSync,site:number):ReviewSummary {
  return reviewSummaries(db,[site]).get(site)??{average:null,ratings:0};
}

export function reviewQueue(db:DatabaseSync,state:ReviewModeration,page:number) {
  return all<{id:number;site_name:string;slug:string;score:number|null;body:string;submitted_at:string;thread_id:number|null;reply_to:number|null}>(db,`SELECT r.id,s.name site_name,s.slug,r.score,r.body,r.submitted_at,r.thread_id,r.reply_to
    FROM user_reviews r JOIN sites s ON s.id=r.site_id AND s.publication='published' WHERE r.moderation=?
    ORDER BY r.submitted_at DESC,r.id DESC LIMIT ? OFFSET ?`,state,reviewPageSize+1,(page-1)*reviewPageSize);
}

export function moderateReview(db:DatabaseSync,id:number,status:unknown,actor:string) {
  const decision=choice(status,["accepted","rejected"],"审核决定");
  transaction(db,()=>{
    const review=one<{body:string;moderation:ReviewModeration;site_id:number;thread_id:number|null;reply_to:number|null}>(db,`SELECT r.body,r.moderation,r.site_id,r.thread_id,r.reply_to FROM user_reviews r
      JOIN sites s ON s.id=r.site_id AND s.publication='published' WHERE r.id=?`,id);
    if (!review) throw new Error("找不到该商家的评价。");
    if (decision===review.moderation) return;
    if (decision==="accepted" && review.body && matchingReviewWords(review.body,reviewBlockedWords(db)).length) throw new Error("评论仍包含屏蔽词，无法公开。");
    if (decision==="accepted" && review.thread_id && !canReply(db,review.site_id,review.thread_id,review.reply_to!)) throw new Error("这条回复的目标尚未公开。");
    db.prepare("UPDATE user_reviews SET moderation=?,ai_pending=0 WHERE id=?").run(decision,id);
    audit(db,actor,"moderate","user_reviews",id,{moderation:review.moderation},{moderation:decision});
  });
}

export function setReviewBlockedWords(db:DatabaseSync,input:unknown,actor:string) {
  if (typeof input!=="string") throw new Error("缺少屏蔽词清单。");
  const words=parseReviewWords(textValue(input,reviewWordListLength,"屏蔽词",false));
  return updateReviewWords(db,actor,()=>words).hidden;
}

export function applySuggestedReviewWords(db:DatabaseSync,actor:string) {
  return updateReviewWords(db,actor,mergeSuggestedReviewWords);
}

function updateReviewWords(db:DatabaseSync,actor:string,resolveWords:(current:readonly ReviewWord[])=>ReviewWord[]) {
  return transaction(db,()=>{
    const before=reviewBlockedWords(db);
    const words=resolveWords(before);
    const oldWords=new Map(before.map(rule=>[rule.normalized,rule.word]));
    const added=words.filter(({normalized})=>!oldWords.has(normalized));
    const result={total:words.length,added:added.length,hidden:0};
    if (words.length===before.length && words.every(rule=>oldWords.get(rule.normalized)===rule.word)) return result;
    db.exec("DELETE FROM review_blocked_words");
    const insert=db.prepare("INSERT INTO review_blocked_words(word,normalized) VALUES (?,?)");
    for (const {word,normalized} of words) insert.run(word,normalized);
    audit(db,actor,"update","review_blocked_words","rules",before,reviewBlockedWords(db));
    if (!added.length) return result;
    const update=db.prepare("UPDATE user_reviews SET moderation='pending' WHERE id=?");
    for (const review of all<{id:number;body:string}>(db,"SELECT id,body FROM user_reviews WHERE moderation='accepted' AND body<>''")) {
      if (!matchingReviewWords(review.body,added).length) continue;
      update.run(review.id);
      audit(db,actor,"moderate","user_reviews",review.id,{moderation:"accepted"},{moderation:"pending",reason:"blocked_words",checked_at:now()});
      result.hidden++;
    }
    return result;
  });
}
