import assert from "node:assert/strict";
import { test } from "node:test";
import { openDirectory,one } from "../../lib/directory/db";
import { exchangeRateFeed,parseExchangeRates,saveExchangeRates,toCnyMinor } from "../../lib/directory/exchange-rates";
import { currentPublicQuotes,publicPriceBoard,storefrontTierNeedsReview } from "../../lib/directory/price-board";
import { aiSubscriptionTier } from "../../lib/directory/ai-subscription-tier";
import { directoryRefreshInterval } from "../../lib/directory/refresh-state";
import { verifiedQuoteAmount } from "../../lib/directory/refresh-quotes";
import { runDirectoryRefresh } from "../../lib/directory/run-refresh";
import { importStorefronts } from "../../lib/directory/storefront-import";
import { getSite,publicPrices } from "../../lib/directory/read";
import type { Visit } from "../../lib/directory/website-check";

const rateFixture=`<Cube><Cube time='2026-11-13'><Cube currency='USD' rate='1.25'/><Cube currency='CNY' rate='7.5'/></Cube></Cube>`;

test("CNY price bands keep AI products, tiers and billing units separate",()=>{
  using db=openDirectory(":memory:");
  const {rates}=parseExchangeRates(rateFixture);
  assert.equal(toCnyMinor(2000,"USD",rates),12000);
  assert.equal(toCnyMinor(245,"JPY",rates),undefined);
  assert.equal(toCnyMinor(3500,"CNY",rates),3500);
  saveExchangeRates(db,rateFixture);
  const original=currentPublicQuotes(db).find(quote=>quote.site_slug==="chatgpt"&&quote.plan==="Plus")!;
  const insert=db.prepare(`INSERT INTO price_records (site_id,source_id,plan,amount_minor,currency,period,region,recorded_at,publication)
    VALUES (?,?,?,?,'CNY',?,?,?,'published')`);
  for (const [plan,amount,billing,region] of [
    ["ChatGPT Plus",21900,"月","菲律宾"],["ChatGPT Plus",150000,"年","中国"],
    ["ChatGPT Pro 100",73000,"月","中国"],["ChatGPT Pro 20x",145000,"月","中国"],
    ["ChatGPT Pro 5x",71000,"月","美国"],["ChatGPT Pro 100 10x",200,"月","中国"],
    ["ChatGPT Plus 年付",300,"月（年付）","中国"],["ChatGPT Free",0,"月","中国"],
  ] as const) insert.run(original.site_id,original.source_id,plan,amount,billing,region,original.recorded_at);
  const dashboard=publicPriceBoard(db);
  const chat=dashboard.groups.find(group=>group.product==="ChatGPT"&&group.tier==="Plus"&&group.period==="月")!;
  const claude=dashboard.groups.find(group=>group.product==="Claude"&&group.period==="年")!;
  assert.equal(chat.quotes.find(quote=>quote.site_slug==="chatgpt")?.cny_minor,12000);
  assert.equal(claude.quotes.find(quote=>quote.site_slug==="claude")?.cny_minor,120000);
  assert.deepEqual(chat.quotes.map(quote=>quote.cny_minor),[12000,21900]);
  const chatTiers=dashboard.groups.filter(group=>group.product==="ChatGPT");
  assert.deepEqual(chatTiers.filter(group=>group.period==="年").map(group=>[group.tier,group.quotes[0].cny_minor]),[["Plus",150000]]);
  assert.deepEqual(chatTiers.filter(group=>group.period==="月").map(group=>group.tier).sort(),["Plus","Pro 100","Pro 200"]);
  assert.deepEqual(chatTiers.find(group=>group.tier==="Pro 100")?.quotes.map(quote=>quote.cny_minor),[71000,73000]);
  db.prepare("UPDATE sites SET status='listed' WHERE slug='chatgpt'").run();
  assert.equal(publicPriceBoard(db).groups.some(group=>group.quotes.some(quote=>quote.site_slug==="chatgpt")),true);
  db.prepare("UPDATE sources SET verified=0 WHERE site_id=?").run(original.site_id);
  assert.equal(publicPriceBoard(db).groups.some(group=>group.quotes.some(quote=>quote.site_slug==="chatgpt")),false);
});

test("AI tier extraction merges established aliases and rejects ambiguous variants",()=>{
  assert.equal(aiSubscriptionTier("ChatGPT","ChatGPT Pro 100（Pro5x）月卡", "月",19900),"Pro 100");
  assert.equal(aiSubscriptionTier("ChatGPT","ChatGPT 20× Pro", "月",19900),"Pro 200");
  assert.equal(aiSubscriptionTier("ChatGPT","ChatGPT Pro $500", "月",19900),"Pro 500");
  assert.equal(aiSubscriptionTier("ChatGPT","ChatGPT Pro 100（10x）", "月",19900),undefined);
  assert.equal(aiSubscriptionTier("ChatGPT","ChatGPT Pro 200（5x）", "月",19900),undefined);
  assert.equal(aiSubscriptionTier("ChatGPT","ChatGPT Pro", "月",19900),undefined);
  assert.equal(aiSubscriptionTier("Claude","Claude Max 5x", "月",19900),"Max");
  assert.equal(aiSubscriptionTier("Claude","Claude Max 20x", "月",19900),"Ultra");
  assert.equal(aiSubscriptionTier("Gemini","Google AI Ultra（20 倍于 Pro 用量）", "月",19900),"Ultra 20×");
  assert.equal(aiSubscriptionTier("Grok","SuperGrok Heavy", "月",19900),"SuperGrok Heavy");
  assert.equal(aiSubscriptionTier("Claude","Pro 年付", "月",19900),undefined);
  assert.equal(aiSubscriptionTier("DeepSeek","Pro", "每 100 万 token",19900),undefined);
});

test("home uses public storefront prices alongside verified quotes and ignores unavailable observations",()=>{
  using db=openDirectory(":memory:");
  saveExchangeRates(db,rateFixture);
  const sourceUrl="https://ai.pricememo.cn/data/v1/snapshots/8890.json";
  const observedAt="2026-01-03T00:00:00.000Z";
  const direct={name:"店铺报价测试",website:"https://quote-fixture.net/",sourceUrl:"https://quote-fixture.net/product/plus",
    category:"ai-topup" as const,observedAt,offers:[
      {plan:"ChatGPT Plus · 代充",cnyMinor:8500,period:"30天"},
      {plan:"ChatGPT Plus · 年卡",cnyMinor:79900,period:"12个月"},
      {plan:"ChatGPT Plus · 试用账号",cnyMinor:100,period:"1个月"},
      {plan:"ChatGPT Plus · 成品号",cnyMinor:100,period:"周期未注明"},
    ]};
  const snapshot={...direct,name:"快照报价测试",website:"https://wzyp.cn/shop/fixture1",sourceUrl,
    reportedItemUrl:"https://wzyp.cn/item/fixture1",offers:[{plan:"ChatGPT Plus · 代充",cnyMinor:9000,period:"1个月"}]};
  const discontinued={...snapshot,name:"缺货店铺",website:"https://wzyp.cn/shop/fixture2",reportedItemUrl:"https://wzyp.cn/item/fixture2"};
  const changes=importStorefronts(db,[direct,snapshot,discontinued,{...discontinued,observedAt:"2026-01-04T00:00:00.000Z",
    offers:[{...snapshot.offers[0],notes:"观测时缺货。"}]}]);
  assert.ok(changes.every(row=>!("error" in row)));
  const plus=publicPriceBoard(db).groups.filter(group=>group.product==="ChatGPT"&&group.tier==="Plus");
  assert.deepEqual(plus.find(group=>group.period==="月")?.quotes.map(quote=>quote.cny_minor),[8500,9000,12000]);
  assert.deepEqual(plus.find(group=>group.period==="年")?.quotes.map(quote=>quote.cny_minor),[79900]);
  assert.equal(plus.find(group=>group.period==="月")?.merchants,3);
  assert.ok(currentPublicQuotes(db).every(quote=>!quote.storefront_observed));
});

test("home excludes offers whose original titles conflict with the reported product, tier or billing period",()=>{
  using db=openDirectory(":memory:");
  saveExchangeRates(db,rateFixture);
  const data=[
    ["pro-variant",337050,"1个月 PRO 50X CDK充值 卡冲充值（到期再冲）（质保订阅）"],
    ["wrong-model",19900,"Grok Plus 月卡"],
    ["wrong-period",90000,"ChatGPT Plus 年卡"],
    ["matching-plus",28800,"ChatGPT Plus 正规订阅谷歌 pay 的 Plus 成品号"],
  ] as const;
  const entries=importStorefronts(db,data.map(([key,cnyMinor,productTitle])=>({
    name:"快照测试店铺",website:"https://wzyp.cn/shop/verifiedfixture",sourceUrl:"https://ai.pricememo.cn/data/v1/snapshots/8891.json",
    reportedItemUrl:`https://wzyp.cn/item/${key}`,category:"ai-topup",observedAt:"2026-01-03T00:00:00.000Z",
    offers:[{plan:"ChatGPT Plus · 代充",cnyMinor,period:"1个月",productTitle}],
  })));
  assert.ok(entries.every(row=>!("error" in row)));
  const scope=publicPriceBoard(db).groups.find(group=>group.product==="ChatGPT"&&group.tier==="Plus"&&group.period==="月");
  assert.deepEqual(scope?.quotes.map(quote=>quote.cny_minor),[12000,28800]);
  const store="error" in entries[0]?undefined:getSite(entries[0].slug,db);
  assert.ok(store);
  const original=publicPrices(store.id,db).find(price=>price.amount_minor===337050);
  assert.ok(original);
  assert.equal(storefrontTierNeedsReview(original),true);
  assert.equal(original.product_title,data[0][2]);
});

test("Codex memberships join ChatGPT and per-use verification has its own price group",()=>{
  using db=openDirectory(":memory:");
  const [shop]=importStorefronts(db,[{name:"测试报价",website:"https://codex-fixture.net/",sourceUrl:"https://codex-fixture.net/catalog",
    category:"ai-card",observedAt:"2026-01-03T00:00:00.000Z",offers:[
      {plan:"Codex Plus",cnyMinor:11900,period:"1个月"},
      {plan:"ChatGPT Plus 支持 Codex",cnyMinor:12900,period:"1个月"},
      {plan:"Codex 接码",cnyMinor:400,period:"每次"},
      {plan:"Codex 接码",cnyMinor:100,period:"计价单位未注明"},
    ]}]);
  if("error" in shop)assert.fail(shop.error);
  const groups=publicPriceBoard(db).groups;
  const membership=groups.find(group=>group.product==="ChatGPT"&&group.tier==="Plus"&&group.period==="月");
  assert.deepEqual(membership?.quotes.filter(q=>q.site_id===shop.siteId).map(q=>q.cny_minor),[11900,12900]);
  const verification=groups.find(group=>group.product==="Codex 接码");
  assert.deepEqual(verification?.quotes.map(q=>q.cny_minor),[400]);
  assert.equal(verification?.period,"每次");
  assert.equal(groups.some(group=>group.product==="Codex"),false);
});

test("quote extraction uses the exact plan and billing period, retaining ambiguous or regional mismatches",()=>{
  const monthly={plan:"Pro 月付",period:"月",currency:"USD",region:"官网美元报价"};
  const page="<h2>Pro</h2><p>$17 per month with annual subscription discount ($200 billed up front). $20 if billed monthly.</p><h2>Max</h2><p>$100 if billed monthly</p>";
  assert.equal(verifiedQuoteAmount(page,"https://claude.com/pricing",monthly,"2026-11-15"),2000);
  assert.equal(verifiedQuoteAmount(page,"https://claude.com/pricing",{...monthly,plan:"Pro 年付",period:"年"},"2026-11-15"),20000);
  const offer={"@type":"Offer",price:"65.1",priceCurrency:"CNY",billingDuration:"P1M",eligibleRegion:"中国"};
  const data=(offers:unknown)=>`<script type="application/ld+json">${JSON.stringify({"@type":"Service",name:"Premium",offers})}</script>`;
  const local={plan:"Premium",period:"1 个月",currency:"CNY",region:"中国"};
  assert.equal(verifiedQuoteAmount(data(offer),"https://merchant-fixture.net/pricing",local,"2026-11-15"),6510);
  assert.equal(verifiedQuoteAmount(data([offer,{...offer,price:"72"}]),"https://merchant-fixture.net/pricing",local,"2026-11-15"),undefined);
  assert.equal(verifiedQuoteAmount(data({...offer,eligibleRegion:"美国"}),"https://merchant-fixture.net/pricing",local,"2026-11-15"),undefined);
  const windway="<h3>标准版</h3><p>$ 5.99 / 月</p><p>$ 13.99 / 季</p><p>$ 67.99 / 年</p><h2>FAQ</h2><p>页面价格以美元（USD）展示</p>";
  assert.equal(verifiedQuoteAmount(windway,"https://net-shuttle.com/pricing",{...monthly,plan:"标准版",period:"季"},"2026-11-15"),1399);
  assert.equal(verifiedQuoteAmount(windway.replace("美元（USD）","其他货币"),"https://net-shuttle.com/pricing",{...monthly,plan:"标准版"},"2026-11-15"),undefined);
});

test("five-hour runner resumes partial work, budgets one search and saves only corroborated price changes",async()=>{
  using db=openDirectory(":memory:");
  const previous=currentPublicQuotes(db).find(row=>row.site_slug==="chatgpt")!;
  let instant=Date.parse(`${previous.recorded_at.slice(0,10)}T12:00:00Z`);
  let calls=0;
  const visit:Visit=async (url)=>{
    if (url.pathname==="/robots.txt") return {status:404,body:"",contentType:"text/plain",truncated:false};
    if (url.href===exchangeRateFeed) return {status:200,body:rateFixture,contentType:"text/xml",truncated:false};
    const body=url.hostname==="help.openai.com"?"<p>Price: $21/month (billed monthly)</p>":"<title>Public site</title>";
    return {status:200,body,contentType:"text/html",truncated:false};
  };
  const options={clock:()=>instant,visit,search:async (query:string,_count:number,_fetcher?:typeof fetch,reserve?:()=>void)=>{
    assert.match(query,/pricing plans site:/);reserve?.();calls++;
    return {urls:["https://unrelated-fixture.net/pricing"],returned:1};
  }};
  const first=await runDirectoryRefresh(db,{...options,batch:2});
  assert.equal(first.latest?.done,2);
  const retiredDomain="retired-refresh-fixture.net";
  db.prepare("INSERT INTO directory_refresh_targets(run_id,kind,domain,url) VALUES (?,'domain',?,?)")
    .run(first.latest!.id,retiredDomain,`https://${retiredDomain}/`);
  db.prepare("UPDATE directory_refresh_runs SET targets=targets+1 WHERE id=?").run(first.latest!.id);
  const resumed=await runDirectoryRefresh(db,{...options,batch:250});
  assert.equal(resumed.latest?.id,first.latest?.id);
  assert.equal(resumed.completed?.done,resumed.completed?.targets);
  assert.equal(one<{result:string}>(db,"SELECT result FROM directory_refresh_targets WHERE run_id=? AND domain=?",first.latest!.id,retiredDomain)?.result,"skipped");
  assert.equal(resumed.completed?.billableMilli,5);
  assert.equal(resumed.completed?.quotesChanged,1);
  assert.equal(calls,1);
  assert.equal(currentPublicQuotes(db).find(row=>row.site_slug==="chatgpt")?.amount_minor,2100);
  assert.equal(one<{amount_minor:number}>(db,"SELECT amount_minor FROM price_records WHERE id=?",previous.id)?.amount_minor,2000);
  assert.equal(one<{search_urls:string}>(db,"SELECT search_urls FROM directory_refresh_runs WHERE id=1")?.search_urls,"[]");
  instant+=directoryRefreshInterval-1;
  assert.equal((await runDirectoryRefresh(db,options)).claimed,false);
  instant++;
  const next=await runDirectoryRefresh(db,{...options,batch:250});
  assert.equal(next.completed?.id,2);
  assert.equal(next.completed?.quotesChanged,0);
  assert.equal(calls,2);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
});
