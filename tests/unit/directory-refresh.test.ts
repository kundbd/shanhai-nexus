import assert from "node:assert/strict";
import { test } from "node:test";
import { all,openDirectory,one } from "../../lib/directory/db";
import { saveDiscoverySource } from "../../lib/directory/discovery";
import { exchangeRateFeed,parseExchangeRates,saveExchangeRates,toCnyMinor } from "../../lib/directory/exchange-rates";
import { catalogStartingPrices,currentPublicQuotes,publicPriceBoard,storefrontTierNeedsReview } from "../../lib/directory/price-board";
import { aiSubscriptionTier } from "../../lib/directory/ai-subscription-tier";
import { directoryRefreshInterval } from "../../lib/directory/refresh-state";
import { verifiedQuoteAmount } from "../../lib/directory/refresh-quotes";
import { checkStorefrontQuotes,runDirectoryRefresh } from "../../lib/directory/run-refresh";
import { saveObservedStorefrontAvailability,storefrontAvailabilityAge } from "../../lib/directory/storefront-availability";
import { refreshStorefrontFeed,storefrontFeedAge } from "../../lib/directory/storefront-feed";
import { importStorefronts,type StorefrontObservation } from "../../lib/directory/storefront-import";
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

test("home separates top-ups, finished accounts, official subscriptions and unclassified offers",()=>{
  using db=openDirectory(":memory:");
  saveExchangeRates(db,rateFixture);
  const sourceUrl="https://ai.pricememo.cn/data/v1/snapshots/8890.json";
  const observedAt="2026-01-03T00:00:00.000Z";
  const direct={name:"店铺报价测试",website:"https://quote-fixture.net/",sourceUrl:"https://quote-fixture.net/product/plus",
    category:"ai-topup" as const,observedAt,offers:[
      {plan:"ChatGPT Plus · 代充",cnyMinor:8500,period:"30天"},
      {plan:"ChatGPT Plus · 成品号",cnyMinor:5900,period:"1个月"},
      {plan:"ChatGPT Plus",productTitle:"ChatGPT Plus 独享成品号",cnyMinor:15900,period:"1个月"},
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
  if ("error" in changes[0]) assert.fail(changes[0].error);
  saveObservedStorefrontAvailability(db,changes[0].siteId,{...direct,offers:direct.offers.map(offer=>({...offer,availability:"available"}))});
  const plus=publicPriceBoard(db,Date.parse(observedAt)+60_000).groups.filter(group=>group.product==="ChatGPT"&&group.tier==="Plus");
  const monthly=(delivery:string)=>plus.find(group=>group.period==="月"&&group.delivery===delivery);
  assert.deepEqual(monthly("topup")?.quotes.map(quote=>quote.cny_minor),[8500]);
  assert.equal(monthly("topup")?.merchants,1);
  assert.equal(monthly("topup")?.unconfirmedStorefronts,1);
  assert.deepEqual(monthly("account")?.quotes.map(quote=>quote.cny_minor),[5900,15900]);
  assert.equal(monthly("account")?.merchants,1);
  assert.deepEqual(monthly("official")?.quotes.map(quote=>quote.cny_minor),[12000]);
  assert.deepEqual(plus.find(group=>group.period==="年"&&group.delivery==="other")?.quotes.map(quote=>quote.cny_minor),[79900]);
  assert.ok(currentPublicQuotes(db).every(quote=>!quote.storefront_observed));
});

test("home excludes offers whose original titles conflict with the reported product, tier, period or delivery",()=>{
  using db=openDirectory(":memory:");
  saveExchangeRates(db,rateFixture);
  const data=[
    ["pro-variant",337050,"1个月 PRO 50X CDK充值 卡冲充值（到期再冲）（质保订阅）","代充"],
    ["wrong-model",19900,"Grok Plus 月卡","代充"],
    ["wrong-period",90000,"ChatGPT Plus 年卡","代充"],
    ["wrong-delivery",2000,"ChatGPT Plus 一个月成品号","代充"],
    ["matching-plus",28800,"ChatGPT Plus 正规订阅谷歌 pay 的 Plus 成品号","成品号"],
  ] as const;
  const entries=importStorefronts(db,data.map(([key,cnyMinor,productTitle,delivery])=>({
    name:"快照测试店铺",website:"https://wzyp.cn/shop/verifiedfixture",sourceUrl:"https://ai.pricememo.cn/data/v1/snapshots/8891.json",
    reportedItemUrl:`https://wzyp.cn/item/${key}`,category:"ai-topup",observedAt:"2026-01-03T00:00:00.000Z",
    offers:[{plan:`ChatGPT Plus · ${delivery}`,cnyMinor,period:"1个月",productTitle}],
  })));
  assert.ok(entries.every(row=>!("error" in row)));
  const monthly=publicPriceBoard(db).groups.filter(group=>group.product==="ChatGPT"&&group.tier==="Plus"&&group.period==="月");
  assert.deepEqual(monthly.find(group=>group.delivery==="account")?.quotes,[]);
  assert.deepEqual(monthly.find(group=>group.delivery==="official")?.quotes.map(quote=>quote.cny_minor),[12000]);
  assert.equal(monthly.some(group=>group.delivery==="topup"||group.delivery==="other"),false);
  const store="error" in entries[0]?undefined:getSite(entries[0].slug,db);
  assert.ok(store);
  const original=publicPrices(store.id,db).find(price=>price.amount_minor===337050);
  assert.ok(original);
  assert.equal(storefrontTierNeedsReview(original),true);
  assert.equal(original.product_title,data[0][2]);
});

test("Codex memberships join ChatGPT and per-use verification has its own price group",()=>{
  using db=openDirectory(":memory:");
  const observation:StorefrontObservation={name:"测试报价",website:"https://codex-fixture.net/",sourceUrl:"https://codex-fixture.net/catalog",
    category:"ai-card",observedAt:"2026-01-03T00:00:00.000Z",offers:[
      {plan:"Codex Plus",cnyMinor:11900,period:"1个月"},
      {plan:"ChatGPT Plus 支持 Codex",cnyMinor:12900,period:"1个月"},
      {plan:"Codex 接码",cnyMinor:400,period:"每次"},
      {plan:"Codex 接码",cnyMinor:100,period:"计价单位未注明"},
    ]};
  const [shop]=importStorefronts(db,[observation]);
  if("error" in shop)assert.fail(shop.error);
  saveObservedStorefrontAvailability(db,shop.siteId,{...observation,offers:observation.offers.map(offer=>({...offer,availability:"available"}))});
  const groups=publicPriceBoard(db,Date.parse(observation.observedAt)+60_000).groups;
  const membership=groups.find(group=>group.product==="ChatGPT"&&group.tier==="Plus"&&group.period==="月"&&group.delivery==="other");
  assert.deepEqual(membership?.quotes.filter(q=>q.site_id===shop.siteId).map(q=>q.cny_minor),[11900,12900]);
  const verification=groups.find(group=>group.product==="Codex 接码");
  assert.deepEqual(verification?.quotes.map(q=>q.cny_minor),[400]);
  assert.equal(verification?.period,"每次");
  assert.equal(verification?.delivery,null);
  assert.equal(groups.some(group=>group.product==="Codex"),false);
});

test("the directory uses listed prices while comparisons require fresh stock, and both exclude a 404",async()=>{
  using db=openDirectory(":memory:");
  const name="测试店铺在售状态";
  const sourceUrl="https://stock-fixture.net/products/plus";
  const plan="ChatGPT Plus 月卡代充";
  let instant=Date.parse("2026-01-03T01:00:00.000Z");
  const observation:StorefrontObservation={name,category:"ai-topup",website:"https://stock-fixture.net/",sourceUrl,
    observedAt:"2026-01-03T00:00:00.000Z",offers:[
      {plan:"ChatGPT Go 月卡卡密",cnyMinor:3800,period:"1个月",notes:"官网标记缺货。"},
      {plan,cnyMinor:5800,period:"1个月"},
    ]};
  const [shop]=importStorefronts(db,[observation]);
  if ("error" in shop) assert.fail(shop.error);
  saveObservedStorefrontAvailability(db,shop.siteId,observation);
  const current=(stamp=instant)=>publicPriceBoard(db,stamp).groups.find(group=>group.product==="ChatGPT"&&group.tier==="Plus"&&group.period==="月"&&group.delivery==="topup")?.quotes;
  assert.deepEqual(current(),[]);
  assert.deepEqual(catalogStartingPrices(db,[shop.siteId],instant).get(shop.siteId),{cnyAmount:58,period:"月",converted:false});
  const html=`<meta property="og:site_name" content="${name}"><script type="application/ld+json">${JSON.stringify({
    "@type":"Product",name:plan,offers:{"@type":"Offer",priceCurrency:"CNY",price:"58.00",availability:"https://schema.org/InStock"},
  })}</script>`;
  let active=true;
  const visit:Visit=async url=>({status:url.pathname==="/robots.txt"||!active?404:200,contentType:"text/html",body:html,truncated:false});
  const options={clock:()=>instant,visit};
  assert.equal((await checkStorefrontQuotes(db,1,plan,options))[0]?.available,1);
  assert.deepEqual(current()?.map(quote=>quote.amount_minor),[5800]);
  assert.equal(current()?.[0].stock_checked_at,new Date(instant).toISOString());
  assert.equal(catalogStartingPrices(db,[shop.siteId],instant).get(shop.siteId)?.cnyAmount,58);
  assert.deepEqual(current(instant+storefrontAvailabilityAge+1),[]);
  assert.equal(catalogStartingPrices(db,[shop.siteId],instant+storefrontAvailabilityAge+1).get(shop.siteId)?.cnyAmount,58);
  assert.equal(publicPrices(shop.siteId,db).length,2);
  instant+=60_000;
  active=false;
  assert.equal((await checkStorefrontQuotes(db,1,plan,options))[0]?.reason,"公开页面返回 HTTP 404");
  assert.equal(one<{state:string}>(db,"SELECT state FROM storefront_quote_checks")?.state,"unavailable");
  assert.deepEqual(current(),[]);
  assert.equal(catalogStartingPrices(db,[shop.siteId],instant).has(shop.siteId),false);
  const old=publicPriceBoard(db,instant,true).groups.find(group=>group.delivery==="topup")?.excludedQuotes[0];
  assert.equal(old?.state,"unavailable");
  assert.equal(old?.evidenceUrl,sourceUrl);
  assert.equal(publicPrices(shop.siteId,db)[0].amount_minor,5800);
});

test("recent feed observations take precedence over third-party list prices and leave comparisons when stock changes",async()=>{
  using db=openDirectory(":memory:");
  const website="https://wzyp.cn/shop/feed-fixture";
  const archive="https://ai.pricememo.cn/data/v1/snapshots/9.json";
  const plan="ChatGPT Plus · 代充", title="ChatGPT Plus 月卡代充";
  const item=(key:string)=>`https://wzyp.cn/item/${key}`;
  const keys=["current","old","wrong-shop","unavailable"];
  const shops=importStorefronts(db,keys.map(key=>({name:"快照测试店",website,sourceUrl:archive,reportedItemUrl:item(key),
    category:"ai-topup",observedAt:"2026-01-01T00:00:00.000Z",offers:[{plan,productTitle:title,period:"1个月",cnyMinor:key==="old"?5800:3800}]})));
  assert.ok(shops.every(shop=>!("error" in shop)));
  if("error" in shops[0]) assert.fail(shops[0].error);
  let now=Date.parse("2026-01-03T01:00:00Z"), id=10;
  const date=(time:number)=>new Date(time).toISOString();
  const offer=(key:string)=>({shop_token:key==="wrong-shop"?"wrong-owner":"feed-fixture",shop_name:"快照测试店",source_platform:"ldxp",
    source_url:item(key),original_name:title,currency:"CNY",price:99,observed_at:date(now-(key==="old"?10_800_000:30_000)),
    delivery_type:"subscription_recharge",service_period:"one_month",stock_status:key==="unavailable"||id>10?"out_of_stock":"in_stock",
    is_comparable:true,is_trusted_price:true});
  let snapshotRequests=0;
  const visit:Visit=async url=>{
    const metadata={schema_version:"price-radar.v1",snapshot_id:String(id),
      snapshot_url:`https://ai.pricememo.cn/data/v1/snapshots/${id}.json`,published_at:date(now-1000),stale:false};
    if(url.pathname==="/robots.txt") return {status:200,body:"User-agent: *\nAllow: /data/",contentType:"text/plain",truncated:false};
    const pointer=url.pathname==="/data/latest.json";
    if(!pointer) snapshotRequests++;
    return {status:200,body:JSON.stringify(pointer?metadata:{...metadata,products:[{
      display_name:"ChatGPT Plus",product_type:"subscription",offers:keys.map(offer),
    }]}),contentType:"application/json",truncated:false};
  };
  const live=(stamp=now)=>publicPriceBoard(db,stamp).groups.find(group=>group.tier==="Plus"&&group.delivery==="topup"&&group.period==="月")?.quotes;
  assert.deepEqual(live(),[]);
  assert.equal(catalogStartingPrices(db,[shops[0].siteId],now).get(shops[0].siteId)?.referenceAt,"2026-01-01T00:00:00.000Z");
  assert.deepEqual(await refreshStorefrontFeed(db,visit,()=>now,1),{state:"updated",quotes:1,snapshot:"https://ai.pricememo.cn/data/v1/snapshots/10.json",publishedAt:date(now-1000)});
  assert.equal(snapshotRequests,1);
  assert.deepEqual(live()?.map(quote=>[quote.cny_minor,quote.reported_item_url,quote.source_url]),[[9900,item("current"),"https://ai.pricememo.cn/data/v1/snapshots/10.json"]]);
  assert.deepEqual(catalogStartingPrices(db,[shops[0].siteId],now).get(shops[0].siteId),{cnyAmount:99,period:"月",converted:false});
  const reviewed=publicPriceBoard(db,now,true).groups.find(group=>group.delivery==="topup")?.excludedQuotes;
  assert.deepEqual(reviewed?.map(row=>row.state),["stale","identity_conflict","out_of_stock"]);
  assert.equal(reviewed?.[2].evidenceUrl,"https://ai.pricememo.cn/data/v1/snapshots/10.json");
  assert.deepEqual(live(now+storefrontFeedAge),[]);
  assert.equal((await refreshStorefrontFeed(db,visit,()=>now+120_000,1)).state,"skipped");
  assert.equal(snapshotRequests,1);
  now+=300_000;
  id++;
  assert.equal((await refreshStorefrontFeed(db,visit,()=>now,2)).state,"updated");
  assert.deepEqual(live(),[]);
  assert.deepEqual(catalogStartingPrices(db,[shops[0].siteId],now).get(shops[0].siteId),
    {cnyAmount:58,period:"月",converted:false,referenceAt:"2026-01-01T00:00:00.000Z"});
  assert.equal(publicPrices(shops[0].siteId,db).length,4);
  assert.deepEqual(publicPrices(shops[0].siteId,db).map(price=>price.amount_minor).sort((a,b)=>a-b),[3800,3800,3800,5800]);
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
    assert.match(query,/lang:zh/);reserve?.();calls++;
    return {urls:[],returned:0};
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
  assert.equal(resumed.completed?.reservedMilli,6);
  assert.equal(resumed.completed?.billableMilli,0);
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
  assert.notEqual(next.completed?.searchQuery,resumed.completed?.searchQuery);
  assert.equal(next.completed?.quotesChanged,0);
  assert.equal(calls,2);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
});

const htmlPage=(body:string)=>({status:200,body,contentType:"text/html",truncated:false});

function shopPage(name:string,prices:[string,number][],visible=false) {
  const title=`${name} - ChatGPT Plus 会员代充商店`;
  const cards=prices.map(([plan,value])=>`<h3>${plan}</h3><p>人民币 ${value}</p><button>立即购买</button>`).join("");
  const products=prices.map(([plan,price])=>({"@type":"Product",name:plan,offers:{"@type":"Offer",price,priceCurrency:"CNY"}}));
  return htmlPage(`<html lang="zh-CN"><title>${title}</title><meta property="og:site_name" content="${name}">
    <h1>${title}</h1><p>本店提供 ChatGPT Plus 会员代充与月付订阅。</p><a href="/products/plus">查看商品</a>
    ${cards}${visible?"":`<script type="application/ld+json">${JSON.stringify(products)}</script>`}</html>`);
}

test("a single scheduled refresh publishes independently corroborated leads and updates direct shop prices",async()=>{
  using db=openDirectory(":memory:",false);
  const site="https://longtail-shop-fixture.net/";
  const [existing]=importStorefronts(db,[{name:"老店测试",website:site,sourceUrl:site,category:"ai-topup",observedAt:"2026-01-03T00:00:00.000Z",
    offers:[{plan:"ChatGPT Plus 月卡",period:"1个月",cnyMinor:8500}]}]);
  if ("error" in existing) assert.fail(existing.error);
  const nextShop="https://new-shop-fixture.net/";
  const hostedA="https://wzyp.cn/shop/fixtureA";
  const hostedB="https://wzyp.cn/shop/fixtureB";
  const blocked="https://catfk.com/shop/fixture";
  const editorial="https://article-fixture.net/";
  const offerMissing="https://missing-price-fixture.net/";
  const network="https://unreachable-fixture.net/";
  const licensed="https://publisher-fixture.net/catalog.json";
  const service="https://small-vps-fixture.net/";
  const sourceFields={name:"已授权的站点链接",pipeline:"vps",kind:"dataset",access:"licensed",url:licensed,
    evidence_url:"https://publisher-fixture.net/license",notes:"允许发现链接。",enabled:1,interval_hours:5};
  saveDiscoverySource(db,{...sourceFields,key:"licensed-fixture"},"tester");
  saveDiscoverySource(db,{...sourceFields,key:"retired-fixture",pipeline:"connections",url:"https://retired-source-fixture.net/"},"tester");
  saveDiscoverySource(db,{...sourceFields,key:"restricted-fixture",access:"restricted",url:"https://restricted-source-fixture.net/"},"tester");
  const access:string[]=[];
  const visit:Visit=async (url)=>{
    access.push(url.href);
    if (url.pathname==="/robots.txt") return {status:404,body:"",contentType:"text/plain",truncated:false};
    if (url.href===exchangeRateFeed) return {status:200,body:rateFixture,contentType:"text/xml",truncated:false};
    if (url.href===licensed) return {status:200,body:JSON.stringify([{url:service,name:"不采用目录里的名称"}]),contentType:"application/json",truncated:false};
    if (url.href===service) return htmlPage(`<title>PinataCloud · VPS 云服务器</title><meta property="og:site_name" content="PinataCloud">
      <meta name="description" content="提供云主机及独立服务器，查看公开月付套餐和价格。">
      <h1>PinataCloud VPS 云服务器</h1><p>我们提供付费云主机套餐。</p><h2>标准套餐</h2><p>月付 9.99 USD</p><button>立即购买</button>
      <a href="/pricing">套餐定价</a><script type="application/ld+json">{"@type":"Service","name":"标准套餐","offers":{"@type":"Offer","price":"9.99","priceCurrency":"USD","billingDuration":"P1M"}}</script>`);
    if (url.href===site) return shopPage("老店测试",[["ChatGPT Plus 月卡",105],["Claude Pro 会员月卡",109]]);
    if (url.href===nextShop) return shopPage("新铺测试",[["ChatGPT Plus 月卡",123],["ChatGPT Pro 会员年卡",1723]],true);
    if (url.href===hostedA) return shopPage("同平台甲店",[["ChatGPT Plus 月卡",123]]);
    if (url.href===hostedB) return shopPage("同平台乙店",[["ChatGPT Plus 月卡",125]]);
    if (url.href===editorial) return htmlPage('<title>AI 代充比价导航</title><h1>AI 代充比价导航</h1><p>我们只做资讯，本站不销售任何商品。</p>');
    if (url.origin===new URL(offerMissing).origin) return shopPage("只是商品介绍",[]);
    if (url.href===network) throw new Error("连接未完成");
    return {status:404,body:"",contentType:"text/plain",truncated:false};
  };
  let requests=0;
  const search=async (_query:string,count:number,_fetcher?:typeof fetch,reserve?:()=>void)=>{
    assert.equal(count,50);
    reserve?.();requests++;
    return {urls:[nextShop,nextShop+"?utm_source=fixture",hostedA,hostedB,blocked,editorial,offerMissing,network],returned:8};
  };
  const settings={visit,search};
  const part=await runDirectoryRefresh(db,{...settings,batch:2});
  assert.equal(part.latest?.finishedAt,null);
  assert.ok(part.latest?.leads.pending);
  const complete=await runDirectoryRefresh(db,{...settings,batch:250});
  assert.equal(complete.completed?.leads.total,8);
  assert.equal(complete.completed?.leads.published,4);
  assert.equal(complete.completed?.leads.held,4);
  assert.equal(complete.completed?.sources.collected,1);
  assert.equal(requests,1);
  assert.equal(complete.completed?.billableMilli,6);
  assert.equal(complete.completed?.quotesChanged,7);
  const listed=all<{website:string;status:string;lifecycle:string;name:string}>(db,"SELECT website,status,lifecycle,name FROM sites ORDER BY website");
  assert.equal(listed.length,5);
  assert.ok(listed.every(row=>row.status==="listed"&&row.lifecycle==="unknown"));
  assert.ok(listed.some(row=>row.name==="PinataCloud"));
  assert.ok(listed.some(row=>row.website===hostedA)&&listed.some(row=>row.website===hostedB));
  const oldPrices=publicPrices(existing.siteId,db);
  assert.equal(oldPrices.find(row=>row.plan==="ChatGPT Plus 月卡")?.amount_minor,10500);
  assert.equal(oldPrices.find(row=>row.plan==="Claude Pro 会员月卡")?.amount_minor,10900);
  assert.equal(access.filter(url=>url.endsWith("catalog.json")).length,1);
  assert.equal(access.some(url=>/catfk\.com|restricted-source-fixture|retired-source-fixture|checkout|login/.test(url)),false);
  assert.equal(one<{result:string}>(db,"SELECT result FROM directory_refresh_leads WHERE url=?",blocked)?.result,"restricted");
  assert.equal(one<{result:string}>(db,"SELECT result FROM directory_refresh_leads WHERE url=?",network)?.result,"unreachable");
  assert.equal((await runDirectoryRefresh(db,settings)).claimed,false);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
});
