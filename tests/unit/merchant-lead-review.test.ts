import assert from "node:assert/strict";
import { test } from "node:test";
import { all,one,openDirectory } from "../../lib/directory/db";
import { merchantAdmission,admissionStatistics } from "../../lib/directory/merchant-admission";
import { createMerchantCampaign } from "../../lib/directory/merchant-campaign";
import { assessAutomatedAdmission,assessBasicAdmission,assessLeadPage,preferredBasicDetail,type LeadPage } from "../../lib/directory/merchant-lead-page";
import { limitedBacklogVisit,reviewMerchantLeads } from "../../lib/directory/merchant-lead-review";
import { resolveMerchantBacklog } from "../../lib/directory/merchant-backlog";
import { NetworkFailure } from "../../lib/directory/network-transport";
import { WebsiteNetworkFailure } from "../../lib/directory/website-check";
import { getSite } from "../../lib/directory/read";

const page=(url:string,body:string):LeadPage=>({url,body,contentType:"text/html",status:200,truncated:false});
const shop=`<html lang="zh"><title>海盟商店 | ChatGPT Plus 代充</title><meta property="og:site_name" content="海盟商店">
  <meta name="description" content="海盟商店销售 ChatGPT Plus 会员代充与 Claude 卡密套餐。"><h1>AI 会员代充</h1><a href="/products">查看商品</a></html>`;

test("current public page evidence distinguishes a storefront from affiliate, canonical redirect, and parked pages",()=>{
  const url="https://seafront-admission.net/";
  assert.equal(assessLeadPage("ai-retail",page(url,shop)).outcome,"merchant");
  assert.equal(assessLeadPage("ai-retail",page(url,shop.replace("<h1>",`<link rel="canonical" href="https://shared-admission.net/"><h1>`))).outcome,"redirect");
  assert.equal(assessLeadPage("ai-retail",page(url,`<title>ChatGPT 代充导航</title><h1>代充推荐</h1><a href="https://merchant-admission.net/">立即购买</a>`)).outcome,"redirect");
  const comparison=page(url+"plans/",`<html lang="zh"><title>29品牌套餐资料表 | 海盟</title>
    <meta property="og:site_name" content="海盟"><meta name="description" content="比较 29 家机场服务商的套餐和价格">
    <h1>代理机场套餐</h1><a href="/products">查看商品</a></html>`);
  assert.equal(assessLeadPage("connections",comparison).outcome,"insufficient");
  assert.equal(assessLeadPage("ai-retail",page(url,"<title>Buy this domain</title><h1>Buy this domain</h1>")).outcome,"non_merchant");
});

test("lead review is scoped and resumable, and applying it preserves other editorial decisions",async()=>{
  using db=openDirectory(":memory:");
  const campaign=createMerchantCampaign(db,"线索复核测试",10,"editor");
  const add=db.prepare("INSERT INTO merchant_candidates(campaign_id,registrable,pipeline,state,reason) VALUES (?,?,'ai-retail',?,'旧记录')");
  const shopId=Number(add.run(campaign.id,"seafront-admission.net","filtered").lastInsertRowid);
  const restricted=Number(add.run(campaign.id,"restricted-admission.net","unverified").lastInsertRowid);
  const excluded=Number(add.run(campaign.id,"exclude-admission.net","rejected").lastInsertRowid);
  const requestId=Number(db.prepare(`INSERT INTO merchant_requests(campaign_id,query_id,state,unit_milli,started_at,added,returned)
    VALUES (?,(SELECT id FROM merchant_queries WHERE campaign_id=? LIMIT 1),'billable',5,'2026-11-15',2,2)`)
    .run(campaign.id,campaign.id).lastInsertRowid);
  const addUrl=db.prepare("INSERT INTO merchant_urls(request_id,candidate_id,url) VALUES (?,?,?)");
  addUrl.run(requestId,shopId,"https://seafront-admission.net/");
  addUrl.run(requestId,restricted,"https://restricted-admission.net/");
  addUrl.run(requestId,excluded,"https://exclude-admission.net/");
  merchantAdmission(db,campaign.id,[],"editor",true);
  const first=admissionStatistics(db,campaign.id).runId!;
  const touched=new Set<string>();
  const read=async(url:string)=>{
    touched.add(new URL(url).hostname);
    if (url.startsWith("https://restricted-admission")) throw new Error("robots.txt 禁止此路径");
    return page(url,shop);
  };
  const partial=await reviewMerchantLeads(db,first,1,read);
  assert.equal(partial.checked,1);
  assert.throws(()=>merchantAdmission(db,campaign.id,[],"editor",true,first),/全部线索/);
  const final=await reviewMerchantLeads(db,first,50,read);
  assert.equal(final.checked,2);
  assert.equal(final.active,0);
  assert.deepEqual([...touched].sort(),["restricted-admission.net","seafront-admission.net"]);
  const evidence={id:shopId,kind:"official",name:"海盟商店",category:"ai-topup",website:"https://seafront-admission.net/",
    source:"https://seafront-admission.net/",note:"可访问的同域商店首页列有品牌及会员代充商品。"};
  merchantAdmission(db,campaign.id,[evidence],"editor",true,first);
  assert.equal(getSite("seafront-admission-net",db)?.status,"verified");
  const admission=admissionStatistics(db,campaign.id);
  assert.equal(admission.added,1);
  assert.equal(admission.pendingCandidates,1);
  assert.equal(one<{outcome:string}>(db,"SELECT outcome FROM merchant_admission_decisions WHERE run_id=? AND candidate_id=?",admission.runId!,excluded)?.outcome,"excluded");
  assert.equal(all(db,"PRAGMA foreign_key_check").length,0);
});

test("an individual public storefront can be admitted without clearing the other reviews",()=>{
  using db=openDirectory(":memory:");
  const campaign=createMerchantCampaign(db,"补充店铺证据",10,"editor");
  const add=db.prepare("INSERT INTO merchant_candidates(campaign_id,registrable,pipeline,state) VALUES (?,?,'ai-retail',?)");
  const pending=Number(add.run(campaign.id,"seafront-supplement.net","manual").lastInsertRowid);
  const untouched=Number(add.run(campaign.id,"outside-selection.net","manual").lastInsertRowid);
  merchantAdmission(db,campaign.id,[{id:untouched,kind:"hold",note:"该品牌归属仍需与原审核人核实。"}],"editor",true);
  const first=admissionStatistics(db,campaign.id).runId!;
  const source="https://seafront-supplement.net/products/";
  const input=[{id:pending,kind:"identity",name:"海盟卡店",category:"ai-card",website:"https://seafront-supplement.net/",
    source,note:"同域公开店铺列有该品牌的会员卡密商品。"}];
  const scope={run:first,mode:"selection"} as const;
  assert.throws(()=>merchantAdmission(db,campaign.id,input,"editor",false,scope),/证据核对记录/);
  db.prepare("INSERT INTO merchant_verification_attempts(candidate_id,checked_at,outcome,reason,elapsed_ms,proof_url) VALUES (?,?,'identity',?,0,?)")
    .run(pending,"2026-11-15T08:00:00.000Z","直营商品公开页可达",source);
  merchantAdmission(db,campaign.id,input,"editor",true,scope);
  const site=getSite("seafront-supplement-net",db);
  assert.equal(site?.status,"listed");
  assert.equal(site?.reachability,"reachable");
  assert.equal(site?.checked_at,"2026-11-15T08:00:00.000Z");
  const latest=admissionStatistics(db,campaign.id);
  assert.equal(latest.added,1);
  assert.equal(one<{reason:string}>(db,"SELECT reason FROM merchant_admission_decisions WHERE run_id=? AND candidate_id=?",
    latest.runId!,untouched)?.reason,"该品牌归属仍需与原审核人核实。");
  assert.throws(()=>merchantAdmission(db,campaign.id,input,"editor",false,scope),/当前收录批次/);
});

test("basic admission confirms services on product pages without requiring business paperwork",()=>{
  const url="https://tide-catalog.net/";
  const retail=page(url,`<title>海潮小店</title><meta property="og:site_name" content="海潮小店">
    <h1>本店自助发卡</h1><h2>ChatGPT Plus 卡密购买</h2><a href="/products/plus">查看商品</a>`);
  const result=assessBasicAdmission("ai-retail",retail);
  assert.equal(result.basis,"retail");
  assert.equal(result.category,"ai-card");
  assert.equal(result.official,undefined);
  const airport=page(url,`<title>海潮网络</title><h1>本站提供 Clash 节点订阅</h1>
    <h2>月付套餐</h2><a href="https://checkout-vendor.net/">立即订阅</a>`);
  assert.equal(assessBasicAdmission("connections",airport).category,"airport");
  assert.equal(assessBasicAdmission("connections",page(url,`<title>海潮网络加速器</title><h1>独立 VPN 服务</h1>
    <h2>月付套餐</h2><button>开始试用</button>`)).category,"vpn");
  assert.equal(assessBasicAdmission("ai-relay",page(url,`<title>海潮模型服务 · OpenAI 兼容 API 网关</title>
    <h1>统一接入多个模型 API</h1><h2>用量计费</h2><a href="/models">模型目录</a><button>开始使用</button>`)).basis,"gateway");
  for (const sample of [
    page(url,`<title>测试店铺</title><h1>立即购买 ChatGPT Plus 卡密</h1>`),
    page(url,`<title>ChatGPT Plus 购买指南</title><h1>比较和推荐开通渠道</h1><p>立即购买 Claude Pro 卡密</p><a href="/guides/buy">查看教程</a>`),
    page(url,`<title>某品牌网站导航</title><h1>整理多家商家</h1><p>订阅套餐 ¥10</p><a href="/pricing">查看套餐</a>`),
    {...retail,status:404},
  ]) assert.notEqual(assessBasicAdmission("ai-retail",sample).outcome,"merchant");
  assert.equal(preferredBasicDetail("/terms-of-service"),0);
  assert.equal(preferredBasicDetail("/goods/plus"),5);
});

const publicStore=(name:string)=>`<html><title>`+name+`</title><meta property="og:site_name" content="`+name+`">
  <h1>本站提供 AI 会员卡密</h1><h2>ChatGPT Plus 月卡</h2>
  <a href="/products/plus">ChatGPT Plus 月卡购买</a><button>加入购物车</button></html>`;

test("automatic admission requires real first-party offerings rather than an editorial page or self-hosted app",()=>{
  const url="https://coastal-automation.net/";
  assert.equal(assessAutomatedAdmission("ai-retail",page(url,publicStore("海角卡密"))).category,"ai-card");
  const vpn=page(url,`<title>海角网络</title><h1>本站提供独立 VPN 服务</h1>
    <h2>标准版套餐 100GB</h2><button>开始试用</button>`);
  assert.equal(assessAutomatedAdmission("connections",vpn).category,"vpn");
  const guide=page(url,`<title>付费机场排行与实测</title>
    <h1>购买节点订阅</h1><p>汇总各家公开套餐。</p><a href="https://other-store.net/">立即订阅</a>`);
  assert.notEqual(assessAutomatedAdmission("connections",guide).outcome,"merchant");
  const software=page(url,`<title>本地 API 网关</title><h1>OpenAI 兼容 API 网关</h1>
    <p>开源部署，自部署软件。模型目录取决于您自己的供应商。</p><a href="/docs">安装</a>`);
  assert.notEqual(assessAutomatedAdmission("ai-relay",software).outcome,"merchant");
});

test("backlog processing resumes, retries transient errors once, and publishes the completed batch exactly once",async()=>{
  using db=openDirectory(":memory:");
  const campaign=createMerchantCampaign(db,"积压自动收录测试",10,"editor");
  const candidate=db.prepare("INSERT INTO merchant_candidates(campaign_id,registrable,pipeline,state) VALUES (?,?,'ai-retail','filtered')");
  const domains=["seller-resume.net","offline-resume.net","blocked-resume.net","parking-resume.net","link-resume.net","evidence-resume.net"];
  for (const name of domains) candidate.run(campaign.id,name);
  merchantAdmission(db,campaign.id,[],"editor",true);
  const original=admissionStatistics(db,campaign.id).runId!;
  const calls=new Map<string,number>();
  const read=async(url:string)=>{
    const domain=new URL(url).hostname;
    calls.set(domain,(calls.get(domain)??0)+1);
    if (domain==="seller-resume.net") return page(url,publicStore("可续跑卡密商店"));
    if (domain==="offline-resume.net") throw new WebsiteNetworkFailure("robots",new NetworkFailure("connect_timeout","connect"));
    if (domain==="blocked-resume.net") throw new Error("robots.txt 禁止此路径");
    if (domain==="link-resume.net") throw new Error("跳往其他注册域（wise.com），需人工确认");
    if (domain==="parking-resume.net") return page(url,"<title>Buy this domain</title>");
    return page(url,"<title>海边通讯录</title><h1>联系我们</h1>");
  };
  assert.equal((await reviewMerchantLeads(db,original,1,read,"backlog")).checked,1);
  assert.equal(resolveMerchantBacklog(db,original,"editor",true).ready,false);
  assert.equal((await reviewMerchantLeads(db,original,50,read,"backlog")).checked,domains.length);
  assert.equal(calls.get("offline-resume.net"),2);
  assert.equal(calls.get("blocked-resume.net"),1);
  assert.equal(calls.get("seller-resume.net"),1);
  resolveMerchantBacklog(db,original,"editor",true);
  assert.equal(getSite("seller-resume-net",db)?.status,"listed");
  const stats=admissionStatistics(db,campaign.id);
  assert.equal(stats.added,1);
  assert.equal(stats.archived,3);
  assert.equal(stats.pendingCandidates,0);
  assert.ok(stats.outcomes.some(row=>row.outcome==="duplicate"&&row.n===1));
  assert.equal(one<{id:number}>(db,"SELECT id FROM merchant_admission_runs WHERE reviewed_run_id=?",original)?.id,stats.runId);
  const replay=resolveMerchantBacklog(db,original,"editor",true);
  assert.ok("alreadyApplied" in replay&&replay.alreadyApplied);
  assert.equal(admissionStatistics(db,campaign.id).runId,stats.runId);
  assert.equal((await reviewMerchantLeads(db,stats.runId!,50,read,"backlog")).total,0);
});

test("a backlog transport shares successful robots checks and spaces requests to the same registered domain",async()=>{
  const starts:number[]=[];
  const read=limitedBacklogVisit(async()=>{starts.push(performance.now());return {status:200,body:"",contentType:"text/plain",truncated:false};},100,15);
  const signal=AbortSignal.timeout(1000);
  const root=new URL("https://coastal-limited.net/robots.txt");
  await read(root,signal,64);
  await read(root,signal,64);
  await Promise.all([read(new URL("/plans",root),signal,64),read(new URL("https://store.coastal-limited.net/shop",root),signal,64)]);
  assert.equal(starts.length,3);
  assert.ok(starts[1]-starts[0]>=14);
  assert.ok(starts[2]-starts[1]>=14);
});
