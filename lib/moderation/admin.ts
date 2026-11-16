import type { DatabaseSync } from "node:sqlite";
import { discardCommunityFiles } from "../community/media";
import { all,one,transaction } from "../directory/db";
import { matchingReviewWords } from "../directory/review-word-rules";
import { reviewBlockedWords } from "../directory/reviews";
import { audit } from "../directory/write";
import { screenContent } from "./service";
import type { ContentSurface } from "./policy";
import { recordContentPenalty } from "./store";

type Item={id:number;account:number|null;body:string;pending:number};
function moderationItem(db:DatabaseSync,surface:ContentSurface,id:number) {
  const sql=surface==="post"?
    "SELECT id,author_id account,body,ai_pending pending FROM community_posts WHERE id=? AND hidden=0":
    "SELECT id,account_id account,body,ai_pending pending FROM user_reviews WHERE id=? AND moderation<>'rejected'";
  return one<Item>(db,sql,id);
}

export function pendingModeration(db:DatabaseSync,page:number) {
  return all<Item&{surface:ContentSurface}>(db,`SELECT * FROM (
    SELECT id,author_id account,body,ai_pending pending,'post' surface,created_at time FROM community_posts WHERE hidden=0 AND ai_pending=1
    UNION ALL
    SELECT id,account_id account,body,ai_pending pending,'review' surface,unixepoch(submitted_at)*1000 time FROM user_reviews WHERE moderation='pending' AND ai_pending=1
  ) ORDER BY time DESC, surface, id DESC LIMIT 31 OFFSET ?`,(page-1)*30);
}

export function approvePendingPost(db:DatabaseSync,id:number,actor:string) {
  transaction(db,()=>{
    const post=moderationItem(db,"post",id);
    if(!post?.pending)throw new Error("找不到待复核的帖子。");
    if(matchingReviewWords(post.body,reviewBlockedWords(db)).length)throw new Error("帖子仍包含屏蔽词，无法公开。");
    db.prepare("UPDATE community_posts SET ai_pending=0 WHERE id=?").run(id);
    audit(db,actor,"approve","community_posts",id,{ai_pending:1},{ai_pending:0});
  });
}

export async function moderateWithAi(db:DatabaseSync,surface:ContentSurface,id:number,actor:string) {
  const item=moderationItem(db,surface,id);
  if(!item?.body)throw new Error("找不到可供 AI 审核的文字。");
  const assessment=await screenContent(db,item.account,surface,item.body);
  if(!assessment)throw new Error("AI 审核未启用。");
  if(assessment.decision==="review")return "DSH 暂未给出可执行的结论，请人工复核。";
  if(assessment.decision==="allow") {
    if(item.pending&&surface==="post")approvePendingPost(db,id,actor);
    if(surface==="review") db.prepare("UPDATE user_reviews SET ai_pending=0 WHERE id=?").run(id);
    return "DSH 审核通过。";
  }
  const {category}=assessment;
  const {files,message}=transaction(db,()=>{
    const current=moderationItem(db,surface,id);
    if(!current||current.body!==item.body)throw new Error("内容已变更，请刷新后重试。");
    let files:string[]=[];
    if(surface==="post") {
      files=all<{id:string}>(db,"SELECT id FROM community_media WHERE post_id=?",id).map(file=>file.id);
      db.prepare("UPDATE community_posts SET hidden=1,ai_pending=0 WHERE id=?").run(id);
      db.prepare("DELETE FROM community_media WHERE post_id=?").run(id);
    } else {
      db.prepare("UPDATE user_reviews SET moderation='rejected',ai_pending=0 WHERE id=?").run(id);
    }
    const penalty=current.account===null?undefined:recordContentPenalty(db,current.account,surface,`existing:${id}`,current.body,category);
    audit(db,actor,"remove",surface==="post"?"community_posts":"user_reviews",id,null,{reason:"dsh",category,strike:penalty?.strike});
    return {files,message:penalty?(penalty.strike===1?"已移除内容并警告账号。":"已移除内容，账号处于 3 天禁言期。"):"已移除历史内容。这条内容没有关联账号。"};
  });
  await discardCommunityFiles(files);
  return message;
}
