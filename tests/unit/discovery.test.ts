import assert from "node:assert/strict";
import { test } from "node:test";
import { openDirectory,all,one } from "../../lib/directory/db";
import { deepSeekSearchUsage,discoveryJobs,queueDiscovery,queueDue,retryDiscovery,runDiscovery,saveDiscoverySource } from "../../lib/directory/discovery";
import { deepSeekSearchEndpoint,deepSeekSearchReference,searchDeepSeek } from "../../lib/directory/deepseek-search";
import { discoverFrom,externalSalesLink,parseMerchantMetadata } from "../../lib/directory/discovery-providers";
import { assessMerchant,leadUrl,searchQueries } from "../../lib/directory/discovery-rules";
import { approveItems,getBatch,publishBatch } from "../../lib/directory/imports";
import { directoryStats,getSite,listSites } from "../../lib/directory/read";
import { readPublicPage } from "../../lib/directory/website-check";

const source={key:"test-manual",kind:"manual",name:"测试来源",pipeline:"ai-retail",access:"leads",
  url:"https://legitimate-source.net/",evidence_url:"https://legitimate-source.net/terms",notes:"测试用独立公开信息"};
const actualMerchant='<html lang="zh-CN"><title>蓝鲸小店 | ChatGPT Plus 代充</title><meta property="og:site_name" content="蓝鲸小店"><meta name="description" content="ChatGPT Plus 会员充值套餐与售后说明"></html>';
const mockRead: NonNullable<Parameters<typeof runDiscovery>[1]>["read"]=async(url)=>({url,status:200,body:actualMerchant,contentType:"text/html",truncated:false});

test("classifies with storefront evidence and deduplicates products without grouping public-suffix tenants",()=>{
  assert.equal(leadUrl("https://www.alpha.co.uk/plans?aff=4").registrable,"alpha.co.uk");
  assert.equal(leadUrl("https://www.alpha.co.uk/plans?aff=4").url,"https://www.alpha.co.uk/plans");
  assert.notEqual(leadUrl("https://foo.github.io").registrable,leadUrl("https://bar.github.io").registrable);
  assert.throws(()=>leadUrl("https://aitest123.com/sites/all"),/目录/);
  assert.throws(()=>leadUrl("https://alpha.co.uk/subscribe/customer-token"),/非公开/);
  const classification=assessMerchant("ai-retail",parseMerchantMetadata(actualMerchant));
  assert.equal(classification.accepted,true);
  assert.equal(classification.name,"蓝鲸小店");
  assert.equal(classification.language,"zh-CN");
  assert.equal(assessMerchant("ai-retail",{title:"AI 订阅比价平台",description:"ChatGPT 代充与 Claude 充值价格对比"}).accepted,false);
  assert.equal(assessMerchant("connections",{title:"随想博客",description:"分享生活"}).accepted,false);
  assert.equal(externalSalesLink('<a href="https://merchant-two.net/start">立即购买</a>',"https://merchant-one.net/"),"merchant-two.net");
  assert.ok(searchQueries("ai-retail").some(query=>query.lang==="en"));
  assert.ok(searchQueries("ai-retail").some(query=>query.lang==="zh-hans"&&query.query.includes("Claude Max")));
});

test("jobs preserve provenance, keep candidates private until approval and skip known domains on rerun",async()=>{
  using db=openDirectory(":memory:");
  const registered=saveDiscoverySource(db,source,"tester");
  const jobId=queueDiscovery(db,registered.id,"tester",true);
  assert.equal(queueDiscovery(db,registered.id,"tester",true),jobId);
  const manual=[{url:"https://bluewhale-service.net/plans",evidence:"https://legitimate-source.net/first"},
    {url:"https://bluewhale-service.net/products/2",evidence:"https://legitimate-source.net/second"}];
  const result=await runDiscovery(db,{jobId,manual,read:mockRead});
  assert.equal(result?.state,"ok");
  assert.equal(result?.candidates,1);
  assert.equal(result?.duplicates,1);
  assert.deepEqual(all<{decision:string}>(db,"SELECT decision FROM discovery_hits ORDER BY id").map(x=>x.decision),["candidate","duplicate"]);
  assert.equal(listSites({q:"蓝鲸小店"},db).total,0);
  const [row]=getBatch(result!.batch_id!,db);
  assert.equal(approveItems(db,row.batch_id,[row.id],"tester").count,1);
  assert.equal(publishBatch(db,row.batch_id,"tester"),1);
  assert.equal(getSite("bluewhale-service-net",db)?.status,"listed");
  assert.equal(getSite("bluewhale-service-net",db)?.website_language,"zh-CN");
  assert.equal(directoryStats({group:"ai-retail"},db).pending,1);
  assert.equal(listSites({group:"ai-retail",official:"verified"},db).total,0);
  const nextJob=queueDiscovery(db,registered.id,"tester",true);
  assert.equal((await runDiscovery(db,{jobId:nextJob,manual,read:mockRead}))?.candidates,0);
});

test("schedule and retry preserve failures, and a restricted source cannot enter the queue",async()=>{
  using db=openDirectory(":memory:");
  const restricted=saveDiscoverySource(db,{...source,kind:"page",access:"restricted",enabled:true},"tester");
  assert.equal(restricted.enabled,0);
  assert.throws(()=>queueDiscovery(db,restricted.id,"tester"),/不可自动入队/);
  const scheduled=saveDiscoverySource(db,{...source,key:"authorized-page",kind:"page",enabled:true},"tester");
  assert.equal(queueDue(db),1);
  assert.equal(queueDue(db),0);
  const job=await runDiscovery(db,{read:async()=>{throw new Error("robots.txt 禁止此路径");}});
  assert.equal(job?.state,"failed");
  assert.match(job!.errors,/robots/);
  assert.equal(one<{id:number}>(db,"SELECT source_id id FROM discovery_jobs WHERE id=?",job!.id)?.id,scheduled.id);
  assert.notEqual(retryDiscovery(db,job!.id,"tester"),job!.id);
  assert.equal(discoveryJobs(db)[0].state,"queued");
});

test("public sources and sitemap obey robots and disregard cross-site entries",async()=>{
  await assert.rejects(()=>readPublicPage("https://origin-example.net/data",async()=>{
    return {status:200,body:"User-agent: *\nDisallow: /data",contentType:"text/plain",truncated:false};
  }),/robots/);
  const cross=await discoverFrom({pipeline:"connections",kind:"sitemap",access:"official",url:"https://origin-example.net/sitemap.xml"},{
    read:async(url)=>({url,status:200,contentType:"text/xml",truncated:false,
      body:"<urlset><url><loc>https://origin-example.net/services</loc></url><url><loc>https://outside-example.net/other</loc></url></urlset>"}),
  });
  assert.equal(cross.leads.length,1);
});

test("search adapter requests finite pages, does not use snippets and needs configured storage permission",async()=>{
  const oldToken=process.env.DISCOVERY_BRAVE_TOKEN;
  const oldRights=process.env.DISCOVERY_BRAVE_STORAGE_RIGHTS;
  const input={pipeline:"ai-relay",kind:"brave",access:"leads",url:"https://brave.com/search/api/"} as const;
  try {
    process.env.DISCOVERY_BRAVE_TOKEN="test-only";
    delete process.env.DISCOVERY_BRAVE_STORAGE_RIGHTS;
    await assert.rejects(()=>discoverFrom(input),/存储授权/);
    process.env.DISCOVERY_BRAVE_STORAGE_RIGHTS="1";
    const offsets:string[]=[];
    const fetcher:typeof fetch=async url=>{
      const offset=(url as URL).searchParams.get("offset")!;
      offsets.push(offset);
      return Response.json({query:{more_results_available:offset==="0"},web:{results:[{url:`https://brave-test-${offset}.net/`,description:"不存储"}]}});
    };
    const run=await discoverFrom(input,{pageLimit:3,queryLimit:1,fetcher});
    assert.deepEqual(offsets,["0","1"]);
    assert.equal(run.leads.length,2);
    assert.doesNotMatch(JSON.stringify(run),/不存储/);
  } finally {
    if (oldToken===undefined) delete process.env.DISCOVERY_BRAVE_TOKEN; else process.env.DISCOVERY_BRAVE_TOKEN=oldToken;
    if (oldRights===undefined) delete process.env.DISCOVERY_BRAVE_STORAGE_RIGHTS; else process.env.DISCOVERY_BRAVE_STORAGE_RIGHTS=oldRights;
  }
});

test("DeepSeek sends the documented request and does not expose the key or search content",async()=>{
  const previous=process.env.DEEPSEEK_API_KEY;
  const key="test-only-deepseek";
  process.env.DEEPSEEK_API_KEY=key;
  try {
    const result=await searchDeepSeek("ChatGPT Plus 代充",3,async(url,options)=>{
      assert.equal(url,deepSeekSearchEndpoint);
      assert.equal(options?.method,"POST");
      assert.equal(new Headers(options?.headers).get("Authorization"),`Bearer ${key}`);
      assert.equal(options?.redirect,"error");
      assert.deepEqual(JSON.parse(options?.body as string),{query:"ChatGPT Plus 代充",count:3,need_content:false});
      return Response.json({results:[{url:"https://merchant-example.net/pricing",snippet:"retain-no-excerpts"},
        {url:`https://merchant-example.net/${key}`},{url:"file:///secret"}]});
    });
    assert.deepEqual(result,{urls:["https://merchant-example.net/pricing"],returned:3});
    await assert.rejects(()=>searchDeepSeek("AI",1,async()=>new Response(key,{status:402})),{message:"DeepSeek Search HTTP 402（账号余额不足）"});
    await assert.rejects(()=>searchDeepSeek("AI",1,async()=>new Response(key)),{message:"DeepSeek Search 响应无法读取或解析"});
    await assert.rejects(()=>searchDeepSeek("AI",1,async()=>{throw new Error(key);}),{message:"DeepSeek Search 网络请求失败"});
  } finally {
    if (previous===undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY=previous;
  }
});

test("DeepSeek jobs deduplicate and retain sources, enforce shared budget, and retry rate limits",async(t)=>{
  t.mock.timers.enable({apis:["Date"],now:new Date("2026-11-15T20:00:00Z")});
  using db=openDirectory(":memory:");
  const oldKey=process.env.DEEPSEEK_API_KEY;
  const oldLimit=process.env.DEEPSEEK_DISCOVERY_DAILY_LIMIT;
  process.env.DEEPSEEK_API_KEY="test-only-deepseek";
  process.env.DEEPSEEK_DISCOVERY_DAILY_LIMIT="2";
  try {
    const first=saveDiscoverySource(db,{...source,key:"ds-ai",kind:"deepseek",url:deepSeekSearchReference},"tester");
    const second=saveDiscoverySource(db,{...first,key:"ds-network",pipeline:"connections"},"tester");
    const result=await runDiscovery(db,{jobId:queueDiscovery(db,first.id,"tester"),read:mockRead,fetcher:async()=>Response.json({results:[
      {url:"https://ds-merchant.net/plans"},{url:"https://ds-merchant.net/products"},
    ]})});
    assert.equal(result?.state,"ok");
    assert.equal(result?.candidates,1);
    assert.equal(result?.duplicates,1);
    assert.equal(listSites({q:"蓝鲸小店"},db).total,0);
    assert.equal(one<{evidence_url:string}>(db,"SELECT evidence_url FROM discovery_hits LIMIT 1")!.evidence_url,deepSeekSearchReference);
    assert.equal(one<{query_cursor:number}>(db,"SELECT query_cursor FROM discovery_sources WHERE id=?",first.id)!.query_cursor,1);
    const rateLimited=await runDiscovery(db,{jobId:queueDiscovery(db,second.id,"tester"),fetcher:async()=>new Response(null,{status:429})});
    assert.equal(rateLimited?.state,"queued");
    assert.match(rateLimited!.errors,/HTTP 429/);
    const blocked=await runDiscovery(db,{jobId:queueDiscovery(db,first.id,"tester"),fetcher:async()=>assert.fail("Daily cap must stop the request")});
    assert.equal(blocked?.state,"failed");
    assert.match(blocked!.errors,/今日请求额度已用完/);
    assert.deepEqual(deepSeekSearchUsage(db),{day:"2026-11-15",used:2,limit:2});
    t.mock.timers.setTime(Date.parse("2026-11-16T00:00:00Z"));
    assert.deepEqual(deepSeekSearchUsage(db),{day:"2026-11-16",used:0,limit:2});
  } finally {
    if (oldKey===undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY=oldKey;
    if (oldLimit===undefined) delete process.env.DEEPSEEK_DISCOVERY_DAILY_LIMIT; else process.env.DEEPSEEK_DISCOVERY_DAILY_LIMIT=oldLimit;
  }
});
