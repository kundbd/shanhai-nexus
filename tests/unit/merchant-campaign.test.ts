import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync,rmdirSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { all,one,openDirectory } from "../../lib/directory/db";
import { controlMerchantCampaign,createMerchantCampaign,merchantCampaignReport,searchMerchantCampaign,type MerchantSearchProvider } from "../../lib/directory/merchant-campaign";
import { campaignSeeds } from "../../lib/directory/merchant-queries";
import { merchantProof } from "../../lib/directory/merchant-evidence";
import { merchantSearchLead } from "../../lib/directory/discovery-rules";
import { approveItems,publishBatch } from "../../lib/directory/imports";
import { rejectMerchantCandidates,requeueMerchantTimeouts,stageMerchantCampaign,verifyMerchantCampaign } from "../../lib/directory/merchant-verification";
import { getSite,listSites,merchantTags } from "../../lib/directory/read";
import { saveDiscoverySource } from "../../lib/directory/discovery";
import { intakeMerchantSource,merchantSourceReport } from "../../lib/directory/merchant-source-intake";
import { exportMerchantCandidates } from "../../lib/directory/merchant-candidate-export";
import { focusedMerchantSeeds } from "../../lib/directory/focused-merchant-queries";

const offer='<script type="application/ld+json">{"@type":"Product","name":"会员月度","offers":{"@type":"Offer","price":"10.25","priceCurrency":"USD","billingDuration":"P1M"}}</script>';
const store=`<html lang="zh"><title>橙帆卡店 | ChatGPT Plus 代充</title><meta property="og:site_name" content="橙帆卡店"><meta name="description" content="ChatGPT Plus 会员代充、Windsurf 自动充值与套餐"><h1>会员套餐</h1>${offer}<a href="/products">购买</a></html>`;

test("campaign seeds vary by pipeline, language and refinements without duplicate queries",()=>{
  const seeds=campaignSeeds();
  assert.equal(new Set(seeds.map(row=>row.pipeline)).size,5);
  assert.equal(new Set(seeds.map(row=>row.query)).size,seeds.length);
  assert.ok(seeds.length>250);
  assert.ok(seeds.some(row=>row.query.includes("支付宝")&&row.query.endsWith("lang:zh")));
  assert.ok(seeds.some(row=>row.query.includes("Singapore")&&row.query.endsWith("lang:en")));
  assert.equal(merchantSearchLead("https://merchant-test-lab.net/auth/login").target.url,"https://merchant-test-lab.net/");
  assert.throws(()=>merchantSearchLead("https://merchant-test-lab.net/subscribe/token"),/非公开/);
  const focused=focusedMerchantSeeds();
  assert.deepEqual(new Set(focused.map(row=>row.pipeline)),new Set(["ai-retail","connections","ai-relay"]));
  assert.equal(new Set(focused.map(row=>row.query)).size,focused.length);
  assert.ok(focused.some(row=>row.query.includes("成品账号")));
});

test("licensed sightings survive timeout and retry while restricted sources are never read or imported",async()=>{
  using db=openDirectory(":memory:");
  const campaign=createMerchantCampaign(db,"多来源",50,"tester",focusedMerchantSeeds());
  const registry={key:"fixture-registry",name:"测试目录",kind:"dataset",pipeline:"ai-retail",url:"https://open-test-registry.com/providers.json",
    evidence_url:"https://open-test-registry.com/license",notes:"MIT"};
  const licensed=saveDiscoverySource(db,{...registry,access:"licensed"},"tester");
  const restricted=saveDiscoverySource(db,{...registry,key:"fixture-restricted",access:"restricted"},"tester");
  let calls=0;
  const read=async(url:string)=>{calls++;return {url,status:200,contentType:"application/json",truncated:false,body:JSON.stringify({providers:[
    {name:"橙帆卡店",website:"https://merchant-test-lab.net/products",api:"https://api.merchant-test-lab.net/v1"},
    {name:"橙帆卡店",website:"https://www.merchant-test-lab.net/"},
    {name:"推广",website:"https://discard-test-merchant.net/?ref=tracking"},
  ]})};};
  assert.equal((await intakeMerchantSource(db,campaign.id,restricted.id,"provider-json",read)).state,"restricted");
  assert.equal(calls,0);
  assert.equal((await intakeMerchantSource(db,campaign.id,licensed.id,"provider-json",read)).state,"ok");
  assert.equal(one<{n:number}>(db,"SELECT count(*) n FROM merchant_candidates")?.n,1);
  controlMerchantCampaign(db,campaign.id,"running","tester");
  await verifyMerchantCampaign(db,campaign.id,1,undefined,async()=>{throw new Error("公开页面 [headers_timeout] 超时");});
  assert.equal(requeueMerchantTimeouts(db,campaign.id,10),1);
  await verifyMerchantCampaign(db,campaign.id,1,undefined,async(url)=>({url,status:200,contentType:"text/html",body:store,truncated:false}));
  assert.equal(requeueMerchantTimeouts(db,campaign.id,10),0);
  assert.equal(stageMerchantCampaign(db,campaign.id,"tester")[0].items,1);
  assert.deepEqual({...merchantSourceReport(db,campaign.id)[0] as object},{source:"测试目录",domains:1,novel:1,checked:1,verified:1,published_with_source:0,published_first_source:0});
  const scratch=mkdtempSync(join(tmpdir(),"shanhai-candidates-"));
  const path=join(scratch,"candidates.sqlite");
  try {
    assert.equal(exportMerchantCandidates(db,campaign.id,path).candidates,1);
    assert.throws(()=>exportMerchantCandidates(db,campaign.id,path),/EEXIST/);
    using snapshot=new DatabaseSync(path,{readOnly:true});
    assert.equal(one<{license_url:string}>(snapshot,"SELECT license_url FROM source_runs WHERE state='ok'")?.license_url,registry.evidence_url);
    assert.equal(one<{n:number}>(snapshot,"SELECT count(*) n FROM verification_attempts")?.n,2);
    assert.equal(all(snapshot,"PRAGMA foreign_key_check").length,0);
  } finally { rmSync(path,{force:true});rmdirSync(scratch); }
});

test("merchant evidence rejects directory and editorial pages and preserves explicit offer fields",()=>{
  const page={body:store,status:200,url:"https://merchant-test-lab.net/products"};
  const proof=merchantProof("ai-retail",page)!;
  assert.equal(proof.name,"橙帆卡店");
  assert.equal(proof.category,"ai-topup");
  assert.ok(proof.terms.includes("Windsurf"));
  assert.deepEqual(proof.prices,[{product:"会员月度",amount:10.25,currency:"USD",period:"P1M"}]);
  assert.equal(merchantProof("ai-retail",{...page,url:"https://merchant-test-lab.net/guides/how-to"}),null);
  assert.equal(merchantProof("ai-retail",{...page,body:store.replace("橙帆卡店","机场排行榜")}),null);
});

test("campaign budgets survive resume, deduplicate URLs and retain held entries until editorial publication",async()=>{
  using db=openDirectory(":memory:");
  const campaign=createMerchantCampaign(db,"自动验收",10,"tester");
  const seen:string[]=[];
  const provider:MerchantSearchProvider={key:"deepseek",reference:"https://api-docs.deepseek.com/zh-cn/api/search/",unitMilli:5,intervalMs:0,
    search:async(query)=>{ seen.push(query);return {returned:4,urls:["https://merchant-test-lab.net/products?aff=abc","https://www.merchant-test-lab.net/home",
      "https://another-test-merchant.net/products","https://github.com/example"]}; }};
  assert.equal(await searchMerchantCampaign(db,campaign.id,12,"ai-retail",provider),0);
  controlMerchantCampaign(db,campaign.id,"running","tester");
  assert.equal(await searchMerchantCampaign(db,campaign.id,1,"ai-retail",provider),1);
  assert.equal(await searchMerchantCampaign(db,campaign.id,12,"ai-retail",provider),1);
  assert.equal(new Set(seen).size,2);
  const report=merchantCampaignReport(db,campaign.id);
  assert.equal(report.campaign.state,"blocked");
  assert.equal(report.uniqueQueries,2);
  assert.equal(one<{n:number}>(db,"SELECT count(*) n FROM merchant_candidates")?.n,2);
  assert.equal(one<{n:number}>(db,"SELECT count(*) n FROM merchant_urls WHERE url LIKE '%?%'")?.n,0);
  assert.equal(await verifyMerchantCampaign(db,campaign.id,30,undefined,async(url)=>({url,status:200,contentType:"text/html",body:store.replaceAll("橙帆卡店",
    url.includes("another-test")?"北屿卡店":"橙帆卡店"),truncated:false})),2);
  const [stage]=stageMerchantCampaign(db,campaign.id,"tester");
  assert.equal(stage.items,2);
  assert.equal(stageMerchantCampaign(db,campaign.id,"tester").length,0);
  assert.equal(listSites({q:"橙帆卡店"},db).total,0);
  const items=all<{id:number;item_id:number}>(db,"SELECT id,item_id FROM merchant_candidates ORDER BY id");
  assert.equal(rejectMerchantCandidates(db,campaign.id,[items[1].id],"测试拒绝", "tester"),1);
  assert.equal(approveItems(db,stage.batch,items.map(row=>row.item_id),"tester").count,1);
  assert.equal(publishBatch(db,stage.batch,"tester",[items[0].item_id]),1);
  const site=getSite("merchant-test-lab-net",db)!;
  assert.ok(merchantTags(site.id,db).includes("WINDSURF"));
  assert.equal(getSite("another-test-merchant-net",db),undefined);
  assert.equal(one<{n:number}>(db,"SELECT count(*) n FROM merchant_requests")?.n,2);
  assert.equal(all(db,"PRAGMA foreign_key_check").length,0);
});
