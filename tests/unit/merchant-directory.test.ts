import assert from "node:assert/strict";
import { test } from "node:test";
import { all,one,openDirectory } from "../../lib/directory/db";
import { approveItems,conflicts,createImport,getBatch,parseImport,previewPage,publishBatch,reviseItem,sourceEvidence } from "../../lib/directory/imports";
import { getSite,listSites } from "../../lib/directory/read";
import { mergeSites } from "../../lib/directory/site-merge";
import { checkWebsite,robotsPermits,saveCheck,type Visit } from "../../lib/directory/website-check";
import { websiteUrl } from "../../lib/directory/validation";
import { coverageRuns,coverageTotals,intakeSubmission,recordCoverage } from "../../lib/directory/coverage";

test("merchant categories are stable, ports and non-web schemes are rejected and subdomains keep identity",()=>{
  using db=openDirectory(":memory:");
  assert.deepEqual(all<{slug:string}>(db,"SELECT slug FROM categories WHERE parent_slug='ai' ORDER BY position").map(row=>row.slug),
    ["ai-subscriptions","ai-topup","ai-card","ai-relay","ai-platforms"]);
  assert.equal(websiteUrl("EXAMPLE.co.uk").registrable,"example.co.uk");
  assert.equal(websiteUrl("a.example.co.uk").subdomain,"a");
  assert.equal(websiteUrl("tenant.github.io").registrable,"tenant.github.io");
  assert.throws(()=>websiteUrl("https://example.co.uk@127.0.0.1/"));
});

test("batch handles 5,000 rows, replay and paginated review in memory",()=>{
  using db=openDirectory(":memory:");
  const rows=Array.from({length:5000},(_,index)=>({url:`https://fixture-${index}.com`,discovery_name:"隔离测试",source_url:"https://example.org/data",category:"ai-relay"}));
  const payload=JSON.stringify(rows);
  const batch=createImport(db,payload,"json","test");
  assert.equal(previewPage(db,batch,"ready",125).rows.length,40);
  assert.equal(previewPage(db,batch,"ready",125).counts[0].n,5000);
  const replay=createImport(db,payload,"json","test");
  assert.equal(getBatch(replay,db).length,0);
  assert.throws(()=>parseImport(JSON.stringify([...rows,rows[0]]),"json"),/5,000/);
});

test("cross-source duplicates keep evidence, explicit aliases resolve queue entries and merge preserves links",()=>{
  using db=openDirectory(":memory:");
  const first={name:"同名测试服务",url:"https://fixture-one.com",category:"ai-card",summary:"公开档案测试",merchant_details:{delivery_methods:"code,account"}};
  const batch=createImport(db,JSON.stringify([{...first,discovery_name:"A"}, {...first,url:"beta.fixture-one.com",aliases:"同名"}]),"json","test");
  const [row,alias]=getBatch(batch,db);
  const another=createImport(db,JSON.stringify([{...first,discovery_name:"B",source_url:"https://example.org/list"}]),"json","test");
  assert.equal(getBatch(another,db)[0].state,"duplicate");
  assert.equal(sourceEvidence(db,row.id).length,2);
  assert.ok(conflicts(db,row).some(item=>item.domain===alias.domain));
  reviseItem(db,row.id,JSON.stringify({...first,domain_aliases:"beta.fixture-one.com"}),"test",true);
  assert.equal(publishBatch(db,batch,"test"),1);
  assert.equal(getBatch(batch,db)[1].state,"duplicate");
  assert.equal(listSites({q:"beta.fixture-one.com"},db).rows[0].name,first.name);
  const published=getSite("fixture-one-com",db)!;
  assert.match(published.merchant_details,/code,account/);
  const extra=createImport(db,JSON.stringify([{...first,url:"fixture-two.com",name:"旧名测试"}]),"json","test");
  assert.equal(approveItems(db,extra,getBatch(extra,db).map(item=>item.id),"test").count,1);
  assert.equal(publishBatch(db,extra,"test"),1);
  mergeSites(db,getSite("fixture-two-com",db)!.id,published.id,"test");
  assert.equal(getSite("fixture-two-com",db),undefined);
  assert.equal(one<{site_id:number}>(db,"SELECT site_id FROM site_redirects WHERE old_slug='fixture-two-com'")?.site_id,published.id);
  assert.equal(listSites({q:"fixture-two.com",group:"ai-retail"},db).rows[0].id,published.id);
  assert.deepEqual(all(db,"PRAGMA foreign_key_check"),[]);
});

test("website checks obey robots, stop at cross-domain redirects and keep reachability distinct from approval",async()=>{
  assert.equal(robotsPermits("User-agent: *\nDisallow: /\nAllow: /catalog/*/public$","/catalog/one/public"),true);
  assert.equal(robotsPermits("User-agent: *\nDisallow: /\nAllow: /catalog/*/public$","/catalog/one/public/private"),false);
  const calls:string[]=[];
  const reject:Visit=async url=>{calls.push(url.pathname);return {status:200,body:"User-agent: *\nDisallow: /",contentType:"text/plain",truncated:false};};
  assert.equal((await checkWebsite("https://fixture-directory.com",reject)).state,"skipped");
  assert.deepEqual(calls,["/robots.txt"]);
  const redirect:Visit=async url=>({status:url.pathname==="/robots.txt"?404:302,location:"https://external-domain.net",body:"",contentType:"text/html",truncated:false});
  assert.equal((await checkWebsite("https://fixture-directory.com",redirect)).state,"inconclusive");
  const reachable:Visit=async url=>({status:url.pathname==="/robots.txt"?404:200,body:"<title>名称</title>",contentType:"text/html",truncated:false});
  using db=openDirectory(":memory:");
  const batch=createImport(db,"https://fixture-directory.com","urls","test");
  const [row]=getBatch(batch,db);
  const result=await checkWebsite("https://fixture-directory.com",reachable);
  assert.equal(result.title,"名称");
  assert.equal(saveCheck(db,row,result),true);
  assert.equal(getBatch(batch,db)[0].reachability,"reachable");
  assert.equal(getBatch(batch,db)[0].state,"ready");
  assert.equal(approveItems(db,batch,[row.id],"test").count,0);
});

test("licensed intake is idempotent, keeps restricted sources out and publishes only basic data",()=>{
  using db=openDirectory(":memory:");
  const source={pipeline:"ai-retail",access:"licensed",source_name:"开放来源",source_url:"https://fixture-source.com/feed",
    evidence_url:"https://fixture-source.com/license"};
  const payload=[{url:"https://example-shop.com/item/42",name:"示例店铺",category:"ai-card",payments:"待核对"},
    {url:"https://sub.example-shop.com",name:"同域名",category:"ai-card"},
    {url:"https://different-shop.net",name:"错管线",category:"airport"}];
  const run=recordCoverage(db,source,JSON.stringify(payload),"json","test");
  assert.deepEqual(recordCoverage(db,source,JSON.stringify(payload),"json","test"),run);
  assert.throws(()=>recordCoverage(db,{...source,access:"restricted",reason:"无许可"},JSON.stringify(payload),"json","test"),/不能导入/);
  recordCoverage(db,{...source,access:"restricted",reason:"无许可"},"","json","test");
  const [row,duplicate,failed]=getBatch(run.batch_id!,db);
  assert.equal(duplicate.state,"duplicate");
  assert.equal(failed.state,"failed");
  assert.throws(()=>reviseItem(db,row.id,JSON.stringify({...payload[0],category:"airport"}),"test",true),/管线/);
  assert.equal(coverageRuns(db,"ai-retail").find(entry=>entry.batch_id===run.batch_id)?.eligible,1);
  assert.equal(approveItems(db,run.batch_id!,[row.id],"test").count,1);
  assert.equal(publishBatch(db,run.batch_id!,"test"),1);
  assert.equal(getSite("example-shop-com",db)?.basis,"basic");
  assert.equal(getSite("example-shop-com",db)?.payments,null);
  assert.equal(coverageTotals(coverageRuns(db))[0].published,1);
});

test("official intake requires same registrable source and merchant submissions need recorded consent",()=>{
  using db=openDirectory(":memory:");
  const source={pipeline:"vps",access:"official",source_name:"依法查阅官网",source_url:"https://example.org/",
    evidence_url:"https://example.org/"};
  const row={name:"测试云服务商家",url:"https://example-shop.net",category:"vps",summary:"公开云服务器服务说明",
    source_kind:"official",source_url:"https://example.org/about",excerpt:"编辑说明"};
  const run=recordCoverage(db,source,JSON.stringify([row]),"json","test");
  const id=getBatch(run.batch_id!,db)[0].id;
  assert.equal(approveItems(db,run.batch_id!,[id],"test").count,0);
  reviseItem(db,id,JSON.stringify({...row,source_url:"https://help.example-shop.net/about"}),"test",true);
  assert.equal(publishBatch(db,run.batch_id!,"test"),1);
  assert.equal(getSite("example-shop-net",db)?.status,"verified");
  const submission=Number(db.prepare(`INSERT INTO submissions(kind,url,body,submitted_at,merchant_name,merchant_category,publication_consent)
    VALUES ('site','https://merchant-submission.net/','授权公开基础档案','2026-11-15','投稿商家','ai-card',1)`).run().lastInsertRowid);
  assert.throws(()=>intakeSubmission(db,submission,"https://other-provider.net/","test"),/同主体/);
  const candidateRun=intakeSubmission(db,submission,"https://merchant-submission.net/","test");
  assert.deepEqual(intakeSubmission(db,submission,"https://merchant-submission.net/","test"),candidateRun);
  assert.equal(getBatch(candidateRun.batch_id!,db)[0].state,"ready");
});
