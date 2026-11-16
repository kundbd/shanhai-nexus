import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { all,openDirectory,transaction } from "../../lib/directory/db";
import { setReviewBlockedWords,submitReview } from "../../lib/directory/reviews";
import { communityFeed,communityPost,publicCommunityMedia,setCommunityReaction,writeCommunityPost } from "../../lib/community/posts";
import { approvePendingPost,moderateWithAi,pendingModeration } from "../../lib/moderation/admin";
import { deepSeekModeration,parseAssessment } from "../../lib/moderation/provider";
import { screenContent } from "../../lib/moderation/service";
import { latestPenalty,recordContentPenalty,writingMuted } from "../../lib/moderation/store";

function member(db:ReturnType<typeof openDirectory>,username:string) {
  return Number(db.prepare("INSERT INTO member_accounts(issuer,subject,username,created_at) VALUES ('fixture',?,?,?)")
    .run(randomUUID(),username,"2026-01-01").lastInsertRowid);
}

test("new content shares account strikes, retry deduplication and 72 hour expiration",()=>{
  using db=openDirectory(":memory:");
  const user=member(db,"reader");
  const other=member(db,"another");
  const start=Date.now();
  const sample="违规内容示例";
  const first=()=>transaction(db,()=>recordContentPenalty(db,user,"post","root",sample,"scam",start));
  assert.equal(first().strike,1);
  assert.equal(first().strike,1);
  assert.equal(writingMuted(db,user,start),false);
  assert.equal(submitReview(db,"chatgpt",user,{score:"1",body:"另一条违规内容"},start+5,{decision:"violation",category:"harassment"}),"ai_muted");
  const end=start+5+72*60*60*1000;
  assert.equal(latestPenalty(db,user)?.muted_until,end);
  assert.deepEqual(all(db,"SELECT id FROM user_reviews"),[]);
  assert.equal(submitReview(db,"claude",user,{score:"4"},start+6),"muted");
  assert.throws(()=>writeCommunityPost(db,user,"正常文字",[],undefined,start+6),/禁言期/);
  const original=writeCommunityPost(db,other,"正常帖子",[],undefined,start+6);
  assert.throws(()=>setCommunityReaction(db,original.id,user,"repost",true,start+6),/禁言期/);
  assert.equal(setCommunityReaction(db,original.id,user,"like",true,start+6).likes,1);
  assert.equal(writingMuted(db,user,end),false);
  assert.equal(submitReview(db,"claude",user,{score:"4"},end),"submitted");
  assert.deepEqual(all(db,"PRAGMA foreign_key_check"),[]);
});

test("manual review holds posts, replies, attachments and scores out of public views",()=>{
  using db=openDirectory(":memory:");
  const user=member(db,"reader");
  const attachment=randomUUID();
  const root=writeCommunityPost(db,user,"人工复核示例",[{id:attachment,mime:"image/webp",bytes:20}],undefined,Date.now(),true);
  assert.equal(communityPost(root.id,user,db),undefined);
  assert.equal(publicCommunityMedia(attachment,db),undefined);
  assert.equal(communityFeed(1,user,false,db).length,0);
  assert.equal(submitReview(db,"chatgpt",user,{score:"3",body:"待复核的评价"},Date.now(),{decision:"review"}),"submitted");
  assert.equal(pendingModeration(db,1).length,2);
  approvePendingPost(db,root.id,"test-editor");
  assert.equal(communityPost(root.id,user,db)?.body,"人工复核示例");
  assert.equal(publicCommunityMedia(attachment,db)?.content_type,"image/webp");
  const reply=writeCommunityPost(db,user,"待复核的回复",[],root.id,Date.now(),true);
  assert.equal(communityPost(reply.id,user,db),undefined);
  assert.equal(communityPost(root.id,user,db)?.replies,0);
});

test("DSH failures hold text, require quoted evidence, and withdraw historical posts once",async(t)=>{
  const prior=Object.fromEntries(["DSH_MODERATION_ENABLED","DSH_MODERATION_API_KEY","DSH_MODERATION_DAILY_LIMIT"].map(key=>[key,process.env[key]]));
  t.after(()=>{for(const [key,value] of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  process.env.DSH_MODERATION_ENABLED="1";
  process.env.DSH_MODERATION_API_KEY="unit-test-placeholder";
  process.env.DSH_MODERATION_DAILY_LIMIT="3";
  using db=openDirectory(":memory:");
  const user=member(db,"reader");
  const text="这是一段可疑的推广用语";
  setReviewBlockedWords(db,"自定义政治讨论示例","test-editor");
  assert.deepEqual(parseAssessment('{"decision":"violation","category":"scam","evidence":"原文没有的文字"}',text),{decision:"review"});
  const fixture=t.mock.method(globalThis,"fetch",async()=>new Response(null,{status:504}));
  assert.deepEqual(await screenContent(db,user,"post",text),{decision:"review"});
  assert.equal(latestPenalty(db,user),undefined);
  fixture.mock.mockImplementation(async(_address:unknown,request?:RequestInit)=>{
    assert.equal(_address,"https://api.deepseek.com/chat/completions");
    const payload=JSON.parse(String(request?.body));
    assert.deepEqual(JSON.parse(payload.messages[1].content),{text,configured_blocked_words:["自定义政治讨论示例"]});
    return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({decision:"violation",category:"scam",evidence:"可疑的推广用语"})}}]});
  });
  const post=writeCommunityPost(db,user,text,[]);
  assert.match(await moderateWithAi(db,"post",post.id,"test-editor"),/已移除内容并警告/);
  assert.equal(communityPost(post.id,user,db),undefined);
  assert.equal(latestPenalty(db,user)?.strike,1);
  await assert.rejects(moderateWithAi(db,"post",post.id,"test-editor"),/找不到/);
  assert.equal(fixture.mock.callCount(),2);
  process.env.DSH_MODERATION_DAILY_LIMIT="2";
  assert.deepEqual(await screenContent(db,user,"review",text),{decision:"review"});
  assert.equal(fixture.mock.callCount(),2);
});

test("DSH receives an additional normalized view and verifies political evidence against the original",async()=>{
  const body="一起参加時‧政 討論群";
  const config={key:"unit-test-placeholder",model:"fixture",enabled:true};
  const transport:typeof fetch=async(_url,options)=>{
    const payload=JSON.parse(String(options?.body));
    assert.deepEqual(JSON.parse(payload.messages[1].content),{
      text:body,normalized_text:"一起参加時政討論群",configured_blocked_words:["时政讨论群"],
    });
    return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
      decision:"violation",category:"political_advocacy",evidence:"時‧政 討論群",
    })}}]});
  };
  assert.deepEqual(await deepSeekModeration(body,config,transport,["时政讨论群"]),{decision:"violation",category:"political_advocacy"});
  assert.deepEqual(parseAssessment('{"decision":"violation","category":"political_advocacy","evidence":"時政討論群"}',body),{decision:"review"});
});
