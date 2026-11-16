import assert from "node:assert/strict";
import { test } from "node:test";
import { all,one,openDirectory } from "../../lib/directory/db";
import { saveDiscoverySource } from "../../lib/directory/discovery";
import { admissionStatistics,merchantAdmission } from "../../lib/directory/merchant-admission";
import { createMerchantCampaign } from "../../lib/directory/merchant-campaign";
import { intakeMerchantSource } from "../../lib/directory/merchant-source-intake";
import { getDomains,getSite,listSites,publicPrices,publicSources } from "../../lib/directory/read";
import { claimRefresh } from "../../lib/directory/refresh-state";

test("admission separates public identity, verified evidence, aliases and search-only URLs",async()=>{
  using db=openDirectory(":memory:");
  const campaign=createMerchantCampaign(db,"收录测试",10,"editor");
  const add=db.prepare("INSERT INTO merchant_candidates(campaign_id,registrable,pipeline,state,reason,checked_at) VALUES (?,?,?,?,?,?)");
  const id=(domain:string,state:string,reason="")=>Number(add.run(campaign.id,domain,"ai-retail",state,reason,"2026-11-15T01:00:00Z").lastInsertRowid);
  const basic=id("amber-admission.net","filtered");
  const verified=id("green-admission.net","ready");
  const lead=id("search-only-admission.net","unverified","超时");
  const alias=id("alias-admission.net","manual","官网跳往其他注册域（chatgpt.com），需人工确认");
  const source="https://green-admission.net/products";
  assert.throws(()=>merchantAdmission(db,campaign.id,[{id:lead,kind:"independent",category:"ai-topup",name:"未获授权商家",
    website:"https://search-only-admission.net/",source:"https://arbitrary-public-page.net/merchant",note:"未经过授权且没有实际可追溯证据。"}],"editor"),/缺少有复用许可/);
  const audited=saveDiscoverySource(db,{key:"admission-dataset",name:"已审核证据登记",kind:"dataset",pipeline:"ai-retail",access:"licensed",
    url:"https://public-admission-data.net/service-registry.json",evidence_url:"https://public-admission-data.net/license",notes:"单元测试使用的授权目录。"},"editor");
  await intakeMerchantSource(db,campaign.id,audited.id,"licensed-snapshot",undefined,[{url:"https://legacy-admission.net/",name:"旧时卡店"}]);
  const historic=one<{id:number}>(db,"SELECT id FROM merchant_candidates WHERE registrable='legacy-admission.net'")!.id;
  db.prepare("UPDATE merchant_candidates SET state='unverified',reason='robots.txt 连接超时',checked_at='2026-11-15' WHERE id=?").run(historic);
  const official={id:verified,kind:"official",category:"ai-topup",name:"碧涛代充",website:"https://green-admission.net/",source,note:"官网主页面及产品页面均公开列明会员代充服务。"};
  assert.throws(()=>merchantAdmission(db,campaign.id,[official],"editor"),/缺少已完成官网核查/);
  db.prepare("INSERT INTO merchant_verification_attempts(candidate_id,checked_at,outcome,reason,elapsed_ms,proof_url) VALUES (?,?,'ready','',1,?)")
    .run(verified,"2026-11-15T01:00:00Z",source);
  const rows=[official,{id:basic,kind:"identity",category:"ai-card",name:"琥珀卡店",website:"https://amber-admission.net/",
    source:"https://amber-admission.net/products",note:"同域商品页公开列出卡密及品牌联系信息。"},
  {id:historic,kind:"independent",category:"ai-topup",name:"旧时卡店",website:"https://legacy-admission.net/",
    source:audited.url,note:"许可登记数据明确归属此品牌与网站。"},
  {id:alias,kind:"alias",target:"chatgpt.com",source:"https://alias-admission.net/",note:"运营方提供公开链接及别名域名跳转证据。"}];
  assert.equal(merchantAdmission(db,campaign.id,rows,"editor").processed,5);
  assert.equal(listSites({q:"琥珀卡店"},db).total,0);
  merchantAdmission(db,campaign.id,rows,"editor",true);
  const result=admissionStatistics(db,campaign.id);
  assert.equal(result.added,3);
  assert.equal(result.pendingCandidates,1);
  const listed=getSite("amber-admission-net",db)!;
  assert.equal(listed.status,"listed");
  assert.equal(listed.verified_at,null);
  assert.equal(getSite("green-admission-net",db)?.status,"verified");
  assert.equal(getSite("legacy-admission-net",db)?.reachability,"unreachable");
  assert.equal(publicSources(getSite("legacy-admission-net",db)!.id,db)[0].attribution,audited.name);
  assert.ok(getDomains(getSite("chatgpt",db)!.id,db).some(row=>row.domain==="alias-admission.net"&&row.kind==="alias"));
  assert.equal(getSite("search-only-admission-net",db),undefined);
  merchantAdmission(db,campaign.id,rows,"editor",true);
  assert.equal(admissionStatistics(db,campaign.id).added,0);
  assert.equal(all(db,"PRAGMA foreign_key_check").length,0);
});

test("a basic profile retains sourced quotes and suppresses quotes without source evidence",()=>{
  using db=openDirectory(":memory:");
  const site=getSite("chatgpt",db)!;
  assert.ok(publicPrices(site.id,db).length);
  db.prepare("UPDATE sites SET status='listed',verified_at=NULL WHERE id=?").run(site.id);
  assert.ok(publicPrices(site.id,db).length);
  db.prepare("UPDATE sources SET verified=0 WHERE id IN (SELECT source_id FROM price_records WHERE site_id=?)").run(site.id);
  assert.deepEqual(publicPrices(site.id,db),[]);
});

test("historical domain-only records remain internal and are not scheduled for public refresh",()=>{
  using db=openDirectory(":memory:");
  const campaign=createMerchantCampaign(db,"域名收录测试",10,"editor");
  const date="2026-11-15T01:00:00Z";
  const run=Number(db.prepare("INSERT INTO merchant_admission_runs(campaign_id,created_at,actor) VALUES (?,?,?)")
    .run(campaign.id,date,"editor").lastInsertRowid);
  const domain="retired-domain-fixture.net";
  const id=Number(db.prepare("INSERT INTO merchant_candidates(campaign_id,registrable,pipeline,state) VALUES (?,?,'ai-retail','filtered')")
    .run(campaign.id,domain).lastInsertRowid);
  db.prepare(`INSERT INTO merchant_admission_decisions(run_id,candidate_id,outcome,reason,resolved_as)
    VALUES (?,?,'lead','测试','insufficient')`).run(run,id);
  db.prepare("INSERT INTO merchant_domain_listings(domain,admission_run_id,candidate_id,published_at) VALUES (?,?,?,?)").run(domain,run,id,date);
  assert.equal(one<{domain:string}>(db,"SELECT domain FROM merchant_domain_listings WHERE candidate_id=?",id)?.domain,domain);
  assert.equal(one(db,"SELECT name FROM sqlite_schema WHERE type='view' AND name='public_merchant_domains'"),undefined);
  assert.equal(listSites({q:domain},db).total,0);
  const refresh=claimRefresh(db,Date.parse(date))!;
  assert.equal(one(db,"SELECT 1 FROM directory_refresh_targets WHERE run_id=? AND kind='domain'",refresh.run.id),undefined);
  assert.equal(all(db,"PRAGMA foreign_key_check").length,0);
});
