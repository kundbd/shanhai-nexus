import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { all,openDirectory } from "../../lib/directory/db";
import { communityFeed,communityPost,communityReplies,publicCommunityMedia,removeCommunityPost,setCommunityReaction,writeCommunityPost } from "../../lib/community/posts";
import { mediaRange } from "../../lib/community/media";
import { approvePendingPost } from "../../lib/moderation/admin";

test("community feed keeps bookmarks private and signed reposts idempotent",()=>{
  using db=openDirectory(":memory:");
  const insert=db.prepare("INSERT INTO member_accounts(issuer,subject,username,created_at) VALUES ('fixture',?,?,?)");
  const alice=Number(insert.run(randomUUID(),"alice","2026-01-01").lastInsertRowid);
  const bob=Number(insert.run(randomUUID(),"bob","2026-01-01").lastInsertRowid);
  const media=randomUUID();
  const {id}=writeCommunityPost(db,alice,"公开体验",[{id:media,mime:"image/webp",bytes:17}]);
  approvePendingPost(db,id,"fixture",[media]);
  assert.equal(communityPost(id,alice,db)?.username,"alice");
  assert.equal(publicCommunityMedia(media,db)?.content_type,"image/webp");
  assert.throws(()=>writeCommunityPost(db,bob,"刷 单 返 利",[]),/屏蔽词/);
  assert.throws(()=>writeCommunityPost(db,bob,"x".repeat(501),[]),/500/);
  const reply=writeCommunityPost(db,bob,"公开回复",[],id);
  approvePendingPost(db,reply.id,"fixture");
  assert.equal(communityReplies(id,1,bob,db)[0]?.username,"bob");
  assert.equal(communityPost(id,bob,db)?.replies,1);
  setCommunityReaction(db,id,bob,"like",true);
  assert.equal(setCommunityReaction(db,id,bob,"like",true).likes,1);
  setCommunityReaction(db,id,bob,"repost",true);
  assert.equal(communityFeed(1,undefined,false,db).filter(row=>row.reposter==="bob").length,1);
  setCommunityReaction(db,id,bob,"bookmark",true);
  assert.equal(communityFeed(1,bob,true,db).length,1);
  assert.equal(communityFeed(1,alice,true,db).length,0);
  assert.equal(communityFeed(1,undefined,true,db).length,0);
  assert.throws(()=>removeCommunityPost(db,id,bob),/无法删除/);
  assert.deepEqual(removeCommunityPost(db,id,alice).files,[media]);
  assert.equal(communityPost(reply.id,bob,db),undefined);
  assert.equal(communityFeed(1,bob,true,db).length,0);
  assert.equal(publicCommunityMedia(media,db),undefined);
  assert.deepEqual(all(db,"PRAGMA foreign_key_check"),[]);
});

test("media byte ranges include suffixes and reject out-of-bounds or multi-part requests",()=>{
  assert.equal(mediaRange(null,100),undefined);
  assert.deepEqual(mediaRange("bytes=3-8",100),{start:3,end:8});
  assert.deepEqual(mediaRange("bytes=95-1000",100),{start:95,end:99});
  assert.deepEqual(mediaRange("bytes=-10",100),{start:90,end:99});
  for(const value of ["bytes=100-","bytes=10-2","bytes=0-1,4-5","bytes=-0","bytes=-"])assert.equal(mediaRange(value,100),null);
});
