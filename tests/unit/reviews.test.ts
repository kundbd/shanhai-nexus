import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { all,one,openDirectory } from "../../lib/directory/db";
import { getSite,publicReviews } from "../../lib/directory/read";
import { applySuggestedReviewWords,moderateReview,reviewBlockedWords,reviewQueue,reviewRequestAllowed,reviewSummary,setReviewBlockedWords,submitReview } from "../../lib/directory/reviews";
import { mergeSites } from "../../lib/directory/site-merge";
import { publicThread,publicThreads,threadReplies } from "../../lib/directory/community";

let accountNumber=0;
function account(db:DatabaseSync) {
  const subject="review-fixture-"+(++accountNumber);
  return Number(db.prepare("INSERT INTO member_accounts(issuer,subject,username,created_at) VALUES ('fixture',?,?,?)")
    .run(subject,subject,new Date().toISOString()).lastInsertRowid);
}

test("account scores and comments need approval and aggregate only ratings",()=>{
  using db=openDirectory(":memory:");
  const site=getSite("chatgpt",db)!;
  const visitor=account(db);
  assert.equal(submitReview(db,"chatgpt",visitor,{score:"6"}),"invalid");
  assert.equal(submitReview(db,"chatgpt",visitor,{}),"invalid");
  assert.equal(submitReview(db,"chatgpt",visitor,{score:"5"}),"submitted");
  assert.equal(submitReview(db,"chatgpt",visitor,{score:"1"}),"duplicate");
  assert.equal(submitReview(db,"chatgpt",account(db),{body:"响应较快。"}),"submitted");
  assert.equal(submitReview(db,"chatgpt",account(db),{score:"3"}),"submitted");
  assert.deepEqual(publicReviews(site.id,db),[]);
  assert.equal(reviewSummary(db,site.id).average,null);
  for (const row of reviewQueue(db,"pending",1)) moderateReview(db,row.id,"accepted","editor");
  assert.equal(getSite("chatgpt",db)?.review_count,3);
  assert.equal(publicReviews(site.id,db).length,3);
  assert.equal(reviewSummary(db,site.id).average,4);
  assert.equal(reviewSummary(db,site.id).ratings,2);
  const identity=one<{visitor_hash:string|null;account_id:number}>(db,"SELECT visitor_hash,account_id FROM user_reviews ORDER BY id LIMIT 1");
  assert.deepEqual({...identity},{visitor_hash:null,account_id:visitor});
});

test("blocked words match normalized variants and retire previously approved entries",()=>{
  using db=openDirectory(":memory:");
  const site=getSite("chatgpt",db)!;
  const visitor=account(db);
  assert.equal(submitReview(db,"chatgpt",visitor,{body:"刷\u200b 单，返利"}),"blocked");
  assert.equal(submitReview(db,"chatgpt",visitor,{score:"2",body:"我遇到了 AD TEST 的推广。"}),"submitted");
  const row=reviewQueue(db,"pending",1)[0]!;
  moderateReview(db,row.id,"accepted","editor");
  assert.equal(setReviewBlockedWords(db,"ａｄtest\nAd Test","editor"),1);
  assert.deepEqual(publicReviews(site.id,db),[]);
  assert.equal(reviewSummary(db,site.id).average,null);
  assert.throws(()=>moderateReview(db,row.id,"accepted","editor"),/屏蔽词/);
  moderateReview(db,row.id,"rejected","editor");
  assert.equal(reviewQueue(db,"rejected",1).length,1);
  assert.ok(all(db,"SELECT 1 FROM audit_log WHERE entity='review_blocked_words'").length);
});

test("suggested phrases merge without overwriting custom rules and recheck published replies",()=>{
  using db=openDirectory(":memory:");
  setReviewBlockedWords(db,"自定义测试词","editor");
  const site=getSite("chatgpt",db)!;
  assert.equal(submitReview(db,site.slug,account(db),{score:"1",body:"退款没到账，我怀疑遇到了诈骗。"}),"submitted");
  const root=reviewQueue(db,"pending",1)[0]!;
  moderateReview(db,root.id,"accepted","editor");
  const replyTo={thread:String(root.id),reply_to:String(root.id)};
  assert.equal(submitReview(db,site.slug,account(db),{...replyTo,body:"欢迎加微信進福利群。"}),"submitted");
  moderateReview(db,reviewQueue(db,"pending",1)[0]!.id,"accepted","editor");
  const applied=applySuggestedReviewWords(db,"editor");
  assert.ok(applied.added>30);
  assert.equal(applied.hidden,1);
  assert.ok(reviewBlockedWords(db).some(({word})=>word==="自定义测试词"));
  assert.equal(publicThread(root.id,db)?.reply_count,0);
  assert.equal(reviewSummary(db,site.id).average,1);
  assert.equal(submitReview(db,site.slug,account(db),{...replyTo,body:"轉到時政、討論群"}),"blocked");
  assert.deepEqual(applySuggestedReviewWords(db,"editor"),{total:applied.total,added:0,hidden:0});
});

test("account reviews cannot be submitted cross-site or counted twice when shops merge",()=>{
  const url="http://127.0.0.1:3000/api/reviews";
  assert.equal(reviewRequestAllowed(new Request(url,{headers:{"sec-fetch-site":"cross-site"}})),false);
  assert.equal(reviewRequestAllowed(new Request(url,{headers:{"sec-fetch-site":"same-origin",origin:"null"}})),true);
  assert.equal(reviewRequestAllowed(new Request("http://localhost:3000/api/reviews",{headers:{"sec-fetch-site":"same-origin",origin:"http://127.0.0.1:3000"}})),true);
  assert.equal(reviewRequestAllowed(new Request(url,{headers:{origin:"http://127.0.0.1:3000"}})),true);
  using db=openDirectory(":memory:");
  const visitor=account(db);
  const from=getSite("claude",db)!;
  const into=getSite("chatgpt",db)!;
  assert.equal(submitReview(db,from.slug,visitor,{score:"1"}),"submitted");
  assert.equal(submitReview(db,into.slug,visitor,{score:"5"}),"submitted");
  for (const row of reviewQueue(db,"pending",1)) moderateReview(db,row.id,"accepted","editor");
  mergeSites(db,from.id,into.id,"editor");
  assert.equal(getSite(into.slug,db)?.review_count,1);
  assert.equal(publicReviews(into.id,db)[0]?.score,5);
  assert.equal(submitReview(db,from.slug,visitor,{score:"2"}),"missing");
});

test("public discussions show approved text and replies without counting replies as ratings",()=>{
  using db=openDirectory(":memory:");
  const first=account(db);
  const second=account(db);
  const site=getSite("chatgpt",db)!;
  assert.equal(submitReview(db,site.slug,first,{score:"3",body:"网页操作方便。"}),"submitted");
  const root=reviewQueue(db,"pending",1)[0]!;
  const rootAddress={thread:String(root.id),reply_to:String(root.id)};
  assert.deepEqual(publicThreads(1,db),[]);
  assert.equal(submitReview(db,site.slug,second,{...rootAddress,body:"稍后我也试试。"}),"reply_missing");
  moderateReview(db,root.id,"accepted","editor");
  assert.equal(submitReview(db,"claude",second,{...rootAddress,body:"别家话题。"}),"reply_missing");
  assert.equal(submitReview(db,site.slug,second,{...rootAddress,score:"5",body:"不能给回复打分。"}),"reply_missing");
  assert.equal(submitReview(db,site.slug,second,{...rootAddress,body:"刷 单 返 利"}),"blocked");
  assert.equal(submitReview(db,site.slug,second,{...rootAddress,body:"稍后我也试试。"}),"submitted");
  assert.equal(submitReview(db,site.slug,second,{...rootAddress,body:"稍后我也试试。"}),"reply_duplicate");
  assert.deepEqual(threadReplies(root.id,{page:1},db),[]);
  const reply=reviewQueue(db,"pending",1)[0]!;
  moderateReview(db,reply.id,"accepted","editor");
  assert.equal(submitReview(db,site.slug,first,{thread:String(root.id),reply_to:String(reply.id),body:"期待你的体验。"}),"submitted");
  const followUp=reviewQueue(db,"pending",1)[0]!;
  moderateReview(db,followUp.id,"accepted","editor");
  assert.equal(publicThread(root.id,db)?.reply_count,2);
  assert.equal(publicThreads(1,db)[0]?.id,root.id);
  assert.equal(threadReplies(root.id,{preview:true},db)[1]?.reply_to,reply.id);
  assert.equal(getSite(site.slug,db)?.review_count,1);
  assert.equal(reviewSummary(db,site.id).ratings,1);
  assert.equal(reviewSummary(db,site.id).average,3);
  assert.equal(setReviewBlockedWords(db,"稍后我也试试","editor"),1);
  assert.equal(threadReplies(root.id,{page:1},db)[0]?.target_public,0);
  moderateReview(db,root.id,"rejected","editor");
  assert.equal(publicThread(root.id,db),undefined);
  assert.deepEqual(threadReplies(root.id,{page:1},db),[]);
});
