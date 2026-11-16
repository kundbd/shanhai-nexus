import assert from "node:assert/strict";
import test from "node:test";
import { all,openDirectory } from "../../lib/directory/db";
import { recordPageView,trafficReport } from "../../lib/directory/traffic";
import { communityFeed,communityPost,removeCommunityPost,writeCommunityPost } from "../../lib/community/posts";
import { approvePendingPost } from "../../lib/moderation/admin";

test("traffic aggregates public paths by minute and returns the rolling 24-hour ranking",()=>{
  using db=openDirectory(":memory:");
  const now=Date.UTC(2026,10,16,6);
  assert.deepEqual(trafficReport(db,now),{asOf:now,total:0,pages:[]});
  assert.equal(recordPageView(db,"/about",now-86_400_000),true);
  assert.deepEqual(trafficReport(db,now),{asOf:now,total:0,pages:[]});
  assert.equal(recordPageView(db,"/services/chatgpt",now-86_340_000),true);
  for(const page of ["/search","/services/chatgpt","/search","/search","/guides/pdf-to-word"]) {
    assert.equal(recordPageView(db,page,now),true);
  }
  const report=trafficReport(db,now);
  assert.equal(report.total,6);
  assert.deepEqual(report.pages.map(({page,views})=>[page,views]),[
    ["/search",3],["/services/chatgpt",2],["/guides/pdf-to-word",1],
  ]);
  assert.deepEqual(all<{page:string;views:number}>(db,"SELECT page,views FROM page_traffic WHERE page IN ('/search','/about')").map(({page,views})=>[page,views]),[["/search",3]]);
});

test("traffic doesn't store query strings, private routes, unknown paths or identity columns",()=>{
  using db=openDirectory(":memory:");
  const now=Date.UTC(2026,10,16,6);
  db.exec("UPDATE sites SET publication='draft' WHERE slug='chatgpt'");
  for(const page of ["/search?q=private","/search#private","https://example.com/","/admin/traffic","/api/traffic","/services/chatgpt","/services/nonexistent","/services/user%40example.com","/tools/json\n","/community/1\n"]) {
    assert.equal(recordPageView(db,page,now),false,page);
  }
  assert.equal(trafficReport(db,now).total,0);
  assert.deepEqual(all<{name:string}>(db,"PRAGMA table_info(page_traffic)").map(({name})=>name),["minute","page","views"]);
});

test("post views accumulate beyond the rolling traffic window and count only public detail paths",()=>{
  using db=openDirectory(":memory:");
  const now=Date.UTC(2026,10,16,6);
  const member=Number(db.prepare("INSERT INTO member_accounts(issuer,subject,username,created_at) VALUES ('fixture','post-views','reader','2026-01-01')").run().lastInsertRowid);
  const root=writeCommunityPost(db,member,"数字服务体验",[],undefined,now);
  approvePendingPost(db,root.id,"fixture");
  const reply=writeCommunityPost(db,member,"补充",[],root.id,now);
  approvePendingPost(db,reply.id,"fixture");
  const pending=writeCommunityPost(db,member,"审核中",[],undefined,now);
  const path=`/community/posts/${root.id}`;
  assert.equal(communityPost(root.id,undefined,db)?.views,0);
  assert.equal(recordPageView(db,"/community",now),true);
  assert.deepEqual(recordPageView(db,path,now),{views:1});
  assert.deepEqual(recordPageView(db,path,now),{views:2});
  assert.equal(communityFeed(1,undefined,false,db)[0]?.views,2);
  assert.equal(communityPost(reply.id,undefined,db)?.views,0);
  assert.equal(recordPageView(db,`${path}?page=2`,now),false);
  assert.equal(recordPageView(db,`/community/posts/${pending.id}`,now),false);
  assert.equal(recordPageView(db,"/community/posts/9999999999999999",now),false);
  assert.deepEqual(trafficReport(db,now).pages[0],{page:path,views:2,title:`社区帖子 #${root.id}`});
  assert.equal(trafficReport(db,now+86_400_000).total,0);
  assert.equal(communityPost(root.id,undefined,db)?.views,2);
  removeCommunityPost(db,root.id,member);
  assert.equal(recordPageView(db,path,now),false);
  assert.equal(recordPageView(db,`/community/posts/${reply.id}`,now),false);
});
