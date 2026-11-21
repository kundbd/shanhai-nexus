import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { all,openDirectory } from "../../lib/directory/db";
import { recordPageVisitor,trafficReport } from "../../lib/directory/traffic";
import { communityFeed,communityPost,removeCommunityPost,writeCommunityPost } from "../../lib/community/posts";
import { approvePendingPost } from "../../lib/moderation/admin";

test("traffic deduplicates visitors across reloads and reports people across the 24-hour window",()=>{
  using db=openDirectory(":memory:");
  const now=Date.UTC(2026,10,16,6);
  const [first,second,third]=[randomUUID(),randomUUID(),randomUUID()];
  assert.deepEqual(trafficReport(db,now),{asOf:now,total:0,pages:[]});
  assert.equal(recordPageVisitor(db,"/about",first,now-86_400_000),true);
  assert.deepEqual(trafficReport(db,now),{asOf:now,total:0,pages:[]});
  assert.equal(recordPageVisitor(db,"/services/chatgpt",first,now-86_340_000),true);
  for(const [page,visitor] of [["/search",first],["/services/chatgpt",first],["/search",first],["/search",second],["/tools/bin-lookup",third]]) {
    assert.equal(recordPageVisitor(db,page,visitor,now),true);
  }
  const report=trafficReport(db,now);
  assert.equal(report.total,3);
  assert.deepEqual(report.pages.map(({page,visitors})=>[page,visitors]),[
    ["/search",2],["/services/chatgpt",1],["/tools/bin-lookup",1],
  ]);
  assert.equal(all(db,"SELECT 1 FROM traffic_visitors WHERE page='/about'").length,0);
  const hashes=all<{visitor_hash:Uint8Array}>(db,"SELECT visitor_hash FROM traffic_visitors").map(({visitor_hash})=>Buffer.from(visitor_hash).toString("hex"));
  assert.equal(new Set(hashes).size,7);
  assert.ok(hashes.every(hash=>hash.length===64));
});

test("traffic ignores private routes, raw search strings, missing keys and earlier view counts",()=>{
  using db=openDirectory(":memory:");
  const now=Date.UTC(2026,10,16,6);
  const visitor=randomUUID();
  db.exec("UPDATE sites SET publication='draft' WHERE slug='chatgpt'");
  db.prepare("INSERT INTO page_traffic(minute,page,views) VALUES (?,'/search',90)").run(now/60_000);
  for(const page of ["/search?q=private","/search#private","https://example.com/","/admin/traffic","/api/traffic","/services/chatgpt","/services/nonexistent","/services/user%40example.com","/tools/json","/guides/pdf-to-word","/tools/json\n","/community/1\n"]) {
    assert.equal(recordPageVisitor(db,page,visitor,now),false,page);
  }
  assert.equal(recordPageVisitor(db,"/search","bad-identifier",now),false);
  assert.equal(trafficReport(db,now).total,0);
  assert.deepEqual(all<{name:string}>(db,"PRAGMA table_info(traffic_visitors)").map(({name})=>name),["page","visitor_hash","last_seen"]);
});

test("post visitors stay deduplicated beyond the rolling window and only count public detail paths",()=>{
  using db=openDirectory(":memory:");
  const now=Date.UTC(2026,10,16,6);
  const [first,second]=[randomUUID(),randomUUID()];
  const member=Number(db.prepare("INSERT INTO member_accounts(issuer,subject,username,created_at) VALUES ('fixture','post-views','reader','2026-01-01')").run().lastInsertRowid);
  const root=writeCommunityPost(db,member,"数字服务体验",[],undefined,now);
  approvePendingPost(db,root.id,"fixture");
  const reply=writeCommunityPost(db,member,"补充",[],root.id,now);
  approvePendingPost(db,reply.id,"fixture");
  const pending=writeCommunityPost(db,member,"审核中",[],undefined,now);
  const path=`/community/posts/${root.id}`;
  db.prepare("UPDATE community_posts SET view_count=50 WHERE id=?").run(root.id);
  assert.equal(communityPost(root.id,undefined,db)?.visitors,0);
  assert.equal(recordPageVisitor(db,"/community",first,now),true);
  assert.deepEqual(recordPageVisitor(db,path,first,now),{visitors:1});
  assert.deepEqual(recordPageVisitor(db,path,first,now),{visitors:1});
  assert.deepEqual(recordPageVisitor(db,path,second,now),{visitors:2});
  assert.equal(communityFeed(1,undefined,false,db)[0]?.visitors,2);
  assert.equal(communityPost(reply.id,undefined,db)?.visitors,0);
  assert.equal(recordPageVisitor(db,`${path}?page=2`,first,now),false);
  assert.equal(recordPageVisitor(db,`/community/posts/${pending.id}`,first,now),false);
  assert.equal(recordPageVisitor(db,"/community/posts/9999999999999999",first,now),false);
  assert.deepEqual(trafficReport(db,now).pages[0],{page:path,visitors:2,title:`社区帖子 #${root.id}`});
  assert.equal(trafficReport(db,now+86_400_000).total,0);
  assert.deepEqual(recordPageVisitor(db,path,first,now+86_400_000),{visitors:2});
  assert.equal(trafficReport(db,now+86_400_000).total,1);
  removeCommunityPost(db,root.id,member);
  assert.equal(all(db,"SELECT visitor_hash FROM community_post_visitors").length,0);
  assert.equal(recordPageVisitor(db,path,first,now+86_400_000),false);
  assert.equal(recordPageVisitor(db,`/community/posts/${reply.id}`,first,now+86_400_000),false);
});
