import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { all,migrate,one,openDirectory } from "../../lib/directory/db";
import { getCategory,getSite,latestPrices,listPublicCategories,listSites,publicClaims,publicEditorial,publicIncidents,publicPrices } from "../../lib/directory/read";
import { getPublicProduct,productKey } from "../../lib/directory/products";
import { assistDraft,createImport,getBatch,parseImport,publishBatch,reviseItem } from "../../lib/directory/imports";
import { importThirdPartyObservation,writeEntity } from "../../lib/directory/write";
import { saveExchangeRates } from "../../lib/directory/exchange-rates";
import { websiteUrl } from "../../lib/directory/validation";
import { adminActor,login,mutationOrigin } from "../../lib/directory/auth";

test("migration and seed are idempotent and enforce referential integrity", () => {
  using db = openDirectory(":memory:");
  migrate(db);
  const applied=all<{name:string}>(db,"SELECT name FROM migrations ORDER BY name").map(({name})=>name);
  assert.deepEqual(applied,readdirSync("lib/directory/migrations").filter(name=>name.endsWith(".sql")).sort());
  assert.equal(listSites({},db).total,22);
  assert.equal(listSites({status:"verified"},db).total,21);
  assert.equal(listSites({status:"tested"},db).total,0);
  assert.deepEqual(all(db,"PRAGMA foreign_key_check"),[]);
  assert.throws(()=>db.prepare("DELETE FROM categories WHERE slug=?").run("ai-subscriptions"),/FOREIGN KEY/);
});

test("network retirement archives existing stores and makes their public URLs and products unavailable", () => {
  using db = openDirectory(":memory:");
  const retiredSlugs = ["mullvad","proton-vpn","tailscale"];
  db.exec(`DROP TRIGGER retired_network_site_insert;
    DROP TRIGGER retired_network_site_update;
    DELETE FROM migrations WHERE name='040-retire-network-services.sql';
    UPDATE sites SET publication='published' WHERE slug IN ('mullvad','proton-vpn','tailscale');`);
  const vpn = getSite("proton-vpn",db)!;
  const key = productKey(publicPrices(vpn.id,db)[0]);
  assert.ok(getPublicProduct(db,vpn.id,key));

  migrate(db);
  migrate(db);
  for (const slug of retiredSlugs) {
    assert.equal(getSite(slug,db),undefined);
    assert.equal(one<{publication:string}>(db,"SELECT publication FROM sites WHERE slug=?",slug)?.publication,"archived");
  }
  assert.deepEqual(publicPrices(vpn.id,db),[]);
  assert.equal(getPublicProduct(db,vpn.id,key),undefined);
  assert.equal(listSites({q:"proton-vpn"},db).total,0);
  for (const category of ["airport","vpn","proxy-services","residential"]) {
    assert.equal(getCategory(category,db),undefined);
    assert.ok(!listPublicCategories(db).some(({slug})=>slug===category));
  }
  assert.ok(getSite("cloudflare",db));
  assert.throws(()=>db.prepare("UPDATE sites SET publication='published' WHERE id=?").run(vpn.id),/无法发布/);
  assert.equal(one<{count:number}>(db,"SELECT count(*) count FROM audit_log WHERE action='archive'")?.count,retiredSlugs.length);
});

test("third-party observations publish with a traceable source and leave the merchant status intact", () => {
  using db = openDirectory(":memory:");
  const entry = {
    slug:"external-chatgpt-test",merchant:"chatgpt",title:"External coverage",summary:"Published test summary",body:"Testing notes",
    source:{url:"https://arstechnica.com/features/",title:"External test methods",publisher:"Ars Technica",accessedAt:"2025-01-01"},
  };
  const merchant=getSite(entry.merchant,db)!;
  assert.throws(()=>importThirdPartyObservation(db,{...entry,title:""},"editor"),/标题/);
  assert.equal(one(db,"SELECT 1 FROM sources WHERE url=?",entry.source.url),undefined);
  assert.equal(importThirdPartyObservation(db,entry,"editor"),true);
  assert.equal(importThirdPartyObservation(db,entry,"editor"),false);
  assert.equal(importThirdPartyObservation(db,{...entry,slug:"repeated-source"},"editor"),false);
  const observation=publicEditorial(entry.slug,db)!;
  assert.equal(observation.origin,"third_party");
  assert.equal(publicClaims(observation.id,db)[0]?.url,entry.source.url);
  assert.equal(getSite(entry.merchant,db)?.status,merchant.status);
  assert.equal(getSite(entry.merchant,db)?.review_count,merchant.review_count);
  assert.equal(publicEditorial("chatgpt-observation",db)?.origin,"editorial");
});

test("directory search matches historical domains, aliases, Chinese categories and typos", () => {
  using db = openDirectory(":memory:");
  for (const [query,slug] of [["chat.openai.com","chatgpt"],["ChatGTP","chatgpt"],["克劳德","claude"],["TransferWise","wise"],["派安盈","payoneer"]]) {
    assert.equal(listSites({q:query},db).rows[0]?.slug,slug,query);
  }
  const ai = listSites({category:"ai",size:3,page:2},db);
  assert.equal(ai.total,8);
  assert.equal(ai.page,2);
  assert.equal(ai.rows.length,3);
  assert.ok(ai.rows.every((row)=>row.category_slug.startsWith("ai-")));
  assert.equal(listSites({q:"完全没收录xyz"},db).total,0);
  assert.equal(listSites({q:"凭空无效商品xyz987"},db).total,0);
  assert.equal(listSites({q:"谷歌 AI"},db).rows[0]?.slug,"gemini");
  assert.equal(listSites({q:"深度求索"},db).rows[0]?.slug,"deepseek");
  assert.deepEqual(listSites({q:"轻量云"},db).rows.map(({id})=>id).sort(),listSites({q:"VPS"},db).rows.map(({id})=>id).sort());
  assert.equal(listSites({q:"住宅IP",category:"ai"},db).total,0);
});

test("published prices and evidence retain primary sources", () => {
  using db = openDirectory(":memory:");
  const chatgpt = getSite("chatgpt",db)!;
  const price=latestPrices(publicPrices(chatgpt.id,db))[0];
  assert.equal(price.amount_minor,2000);
  assert.match(price.source_url,/help\.openai\.com/);
  const observation=publicEditorial("chatgpt-claude-plans",db)!;
  assert.ok(publicClaims(observation.id,db).every((claim)=>claim.nature==="official" && claim.url?.startsWith("https:")));
  assert.ok(publicIncidents(chatgpt.id,10,db).every((item)=>item.source_url.includes("status.openai.com")));
});

test("directory sorts current starting prices before pagination and leaves unavailable prices at the end", () => {
  using db=openDirectory(":memory:",false);
  const rates="<Cube time='2026-11-16'><Cube currency='USD' rate='1.25'/><Cube currency='CNY' rate='7.5'/><Cube currency='JPY' rate='150'/></Cube>";
  saveExchangeRates(db,rates);
  const makeSite=(slug:string)=>{
    const website=`https://${slug}.net/`;
    const site=Number(writeEntity(db,"sites",{slug,name:`起价样本 ${slug}`,website,category_slug:"vps",summary:"目录排序测试档案。",
      publication:"published",status:"listed"},"tester"));
    const source=Number(writeEntity(db,"sources",{site_id:site,title:"公开套餐",url:website,accessed_at:"2026-11-16",kind:"official",verified:"1",
      excerpt:"测试价格与计费周期。"},"tester"));
    return {site,source};
  };
  function quote({site,source}:ReturnType<typeof makeSite>,plan:string,amount:string,currency:string,date:string) {
    writeEntity(db,"price_records",{site_id:site,source_id:source,plan,amount_minor:amount,currency,period:"月付",
      region:"公开报价",recorded_at:date,publication:"published"},"tester");
  }
  const low=makeSite("lower-price");
  const high=makeSite("higher-price");
  const unpriced=makeSite("unknown-price");
  quote(low,"标准套餐","1000","JPY","2026-11-16");
  quote(high,"标准套餐","100","CNY","2026-11-15");
  quote(high,"标准套餐","10000","CNY","2026-11-16");
  quote(high,"补差价","1","CNY","2026-11-16");
  quote(unpriced,"标准套餐","100","TWD","2026-11-16");

  const base={category:"vps",size:1,includeStartingPrices:true};
  const first=listSites({...base,sort:"price-asc"},db);
  assert.equal(first.rows[0]?.id,low.site);
  assert.deepEqual(first.startingPrices?.get(low.site),{cnyAmount:50,period:"月",converted:true});
  const second=listSites({...base,sort:"price-asc",page:2},db);
  assert.equal(second.rows[0]?.id,high.site);
  assert.equal(second.startingPrices?.get(high.site)?.cnyAmount,100);
  assert.equal(listSites({...base,sort:"price-desc",q:"起价样本"},db).rows[0]?.id,high.site);
  for (const sort of ["price-asc","price-desc"]) {
    const last=listSites({...base,sort,page:3},db);
    assert.equal(last.rows[0]?.id,unpriced.site);
    assert.equal(last.startingPrices?.has(unpriced.site),false);
  }
});

test("CSV, JSON and URL batches audit errors, manual approvals, duplicates and retries", () => {
  using db = openDirectory(":memory:");
  assert.equal(websiteUrl("HTTPS://www.ChatGPT.com./#plans").domain,"chatgpt.com");
  for (const url of ["javascript:alert(1)","https://localhost/","http://10.0.0.1/","http://[::1]/","https://user:pass@example.org","https://example.org:4431"]) assert.throws(()=>websiteUrl(url));
  assert.deepEqual(parseImport('url,name,summary\r\nhttps://example.org,"Sample, name","first\nsecond"',"csv"),[{url:"https://example.org",name:"Sample, name",summary:"first\nsecond"}]);
  assert.throws(()=>parseImport("url,name\nhttps://example.org,\"bad","csv"),/引号/);
  const rowData={url:"https://catalog-check.net/",name:"测试条目",summary:"用于测试导入、批准和发布的隔离数据。",category:"digital-services"};
  const batch=createImport(db,JSON.stringify([rowData,{...rowData,url:"http://www.catalog-check.net/docs"},"file:///etc/passwd","chat.openai.com"]),"json","editor");
  const [row,dupe,bad,alias]=getBatch(batch,db);
  assert.deepEqual([row.state,dupe.state,bad.state,alias.state],["ready","duplicate","failed","duplicate"]);
  assert.equal(publishBatch(db,batch,"editor"),0);
  reviseItem(db,row.id,row.payload,"editor",true);
  assert.equal(publishBatch(db,batch,"editor"),1);
  assert.equal(publishBatch(db,batch,"editor"),0);
  assert.equal(getSite("catalog-check-net",db)?.status,"listed");
  reviseItem(db,bad.id,JSON.stringify({...rowData,url:"https://catalog-retry.net",html:'<title>资料 &amp; 工具</title><meta name="description" content="公开页面简介">'}),"editor",true);
  assert.equal(publishBatch(db,batch,"editor"),1);
  assert.equal(one<{excerpt:string}>(db,"SELECT excerpt FROM sources WHERE site_id=?",getSite("catalog-retry-net",db)!.id)?.excerpt,"公开页面简介");
  assert.equal(getBatch(createImport(db,"https://mullvad.net  \nhttps://other-record.net","urls","editor"),db)[0].state,"duplicate");
});

test("editorial drafts are private; publication, verification and domain ownership are gated", () => {
  using db=openDirectory(":memory:");
  const site = {slug:"review-check",name:"测试服务商",website:"https://review-check.net",category_slug:"digital-services",summary:"只在隔离测试数据库存储的记录。",publication:"draft",status:"listed"};
  const id=writeEntity(db,"sites",site,"tester");
  assert.equal(getSite(site.slug,db),undefined);
  assert.throws(()=>writeEntity(db,"sites",{...site,id,status:"verified"},"tester"),/来源/);
  assert.throws(()=>writeEntity(db,"sites",{...site,slug:"duplicate",website:"https://chat.openai.com/"},"tester"),/域名已经登记/);
  const date=new Date().toISOString().slice(0,10);
  const source=writeEntity(db,"sources",{site_id:id,title:"公开来源",url:"https://review-check.net/pricing",accessed_at:date,kind:"official",verified:"1",excerpt:"公开报价样本。"},"tester");
  assert.throws(()=>writeEntity(db,"sites",{...site,id,publication:"published",status:"tested"},"tester"),/实测/);
  writeEntity(db,"sites",{...site,id,publication:"published",status:"verified"},"tester");
  assert.equal(getSite(site.slug,db)?.status,"verified");
  const editor={slug:"sample-observation",site_id:id,title:"样本观察",summary:"测试",body:"独立编辑文本",publication:"published"};
  assert.throws(()=>writeEntity(db,"editorials",editor,"tester"),/至少需要/);
  writeEntity(db,"editorials",{...editor,claims:JSON.stringify([{label:"价格",statement:"按用量计费。",nature:"official",source_id:source}])},"tester");
  assert.ok(publicEditorial(editor.slug,db));
  assert.throws(()=>writeEntity(db,"sources",{id:source},"tester","delete"));
  writeEntity(db,"sites",{...site,id,publication:"archived",status:"verified"},"tester");
  assert.equal(publicEditorial(editor.slug,db),undefined);
  assert.ok(one(db,"SELECT 1 FROM audit_log WHERE entity='sites' AND entity_id=? AND before_json IS NOT NULL",String(id)));
});

test("admin sessions require environment secrets, reject forged tokens and check origin", () => {
  const keys=["ADMIN_USERNAME","ADMIN_PASSWORD","ADMIN_SESSION_SECRET","ADMIN_ORIGIN"];
  const old=keys.map((key)=>process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(login("admin","example-only-plaintext"),undefined);
    process.env.ADMIN_USERNAME="fixture-editor";
    process.env.ADMIN_PASSWORD="fixture-password-never-deploy";
    process.env.ADMIN_SESSION_SECRET="fixture-secret-for-unit-testing-only";
    process.env.ADMIN_ORIGIN="https://nexus-fixture.net";
    assert.equal(login("fixture-editor","wrong"),undefined);
    const token=login("fixture-editor",process.env.ADMIN_PASSWORD)!;
    assert.equal(adminActor(token),"fixture-editor");
    const signature=token.at(-1)==="A"?"B":"A";
    assert.equal(adminActor(token.slice(0,-1)+signature),undefined);
    assert.ok(mutationOrigin(new Request("http://127.0.0.1",{headers:{origin:"https://nexus-fixture.net"}})));
    assert.ok(!mutationOrigin(new Request("http://127.0.0.1",{headers:{origin:"https://another-fixture.net"}})));
    process.env.ADMIN_PASSWORD="a-different-fixture-password";
    assert.equal(adminActor(token),undefined);
  } finally {
    keys.forEach((key,i)=>{if (old[i]===undefined) delete process.env[key]; else process.env[key]=old[i];});
  }
});

test("AI adapter saves a draft without approving, publishing or replacing the editor summary", async (t) => {
  using db = openDirectory(":memory:");
  const batch = createImport(db,JSON.stringify([{url:"https://draft-check.net",name:"Fixture",summary:"原始编辑简介",category:"digital-services",excerpt:"公开摘录"}]),"json","tester");
  const initial = getBatch(batch,db)[0];
  reviseItem(db,initial.id,initial.payload,"tester",true);
  const before = process.env.EDITOR_AI_ENDPOINT;
  process.env.EDITOR_AI_ENDPOINT = "https://fixture-model.net";
  t.mock.method(globalThis,"fetch",async (_target: string, options: RequestInit) => {
    assert.equal(JSON.parse(String(options.body)).excerpt,"公开摘录");
    return Response.json({summary:"模型生成的草稿"});
  });
  try {
    await assistDraft(db,initial.id,"tester");
    const draft=getBatch(batch,db)[0];
    assert.equal(draft.state,"ready");
    assert.equal(JSON.parse(draft.payload).summary,"原始编辑简介");
    assert.equal(JSON.parse(draft.payload).ai_draft,"模型生成的草稿");
    assert.equal(publishBatch(db,batch,"tester"),0);
  } finally {
    if (before===undefined) delete process.env.EDITOR_AI_ENDPOINT;
    else process.env.EDITOR_AI_ENDPOINT=before;
  }
});
