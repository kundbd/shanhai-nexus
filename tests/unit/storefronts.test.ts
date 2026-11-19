import { strict as assert } from "node:assert";
import { test } from "node:test";
import { openDirectory, one } from "../../lib/directory/db";
import { countPublicAiRetailProducts,directoryStats,getSite,getStorefronts,latestPrices,listSites,publicPrices } from "../../lib/directory/read";
import { mergeSites } from "../../lib/directory/site-merge";
import { importStorefronts,type StorefrontObservation } from "../../lib/directory/storefront-import";
import { priceMemoProductStorefront,storefrontIdentity } from "../../lib/directory/storefront-identity";
import { writeEntity } from "../../lib/directory/write";
import { claimRefresh } from "../../lib/directory/refresh-state";
import { publicProductObservation } from "../../lib/directory/public-product-quote";
import { priceMemoCodexVerificationOffer,priceMemoVisibleOffer,visibleAiProduct } from "../../lib/directory/storefront-product-evidence";
import { offerAiBrand } from "../../lib/directory/ai-product";

const make = (website:string,name="测试店铺"):StorefrontObservation=>({
  website,name,sourceUrl:website,observedAt:"2026-01-03T00:00:00.000Z",category:"ai-card",
  offers:[{plan:"ChatGPT Plus 卡密",cnyMinor:12900,period:"月"}],
});

test("offer icons use the visible brand and distinguish Codex verification from accounts",()=>{
  assert.equal(offerAiBrand(null,"ChatGPT Pro 500 · 卡密","ai-card","shop"),"ChatGPT");
  assert.equal(offerAiBrand("ＧＰＴ５ 账号","成品号","ai-card","shop"),"ChatGPT");
  assert.equal(offerAiBrand("Codex 单次短信验证","ChatGPT Plus","ai-topup","shop"),"Codex 接码");
  assert.equal(offerAiBrand("Codex 成品号 未接码","ChatGPT Free","ai-card","shop"),"ChatGPT");
  assert.equal(offerAiBrand("Gemini Ultra","ChatGPT Plus","ai-card","shop"),"Gemini");
  assert.equal(offerAiBrand("ChatGPT + Claude 组合","Claude","ai-card","shop"),undefined);
  assert.equal(offerAiBrand(null,"GLM-5.2","ai-relay","gateway"),"GLM");
  assert.equal(offerAiBrand("GP,T plus 月卡","代充","ai-card","shop"),"ChatGPT");
  assert.equal(offerAiBrand("Gork Premium CDK","代充","ai-card","shop"),"Grok");
  assert.equal(offerAiBrand("GitHub Copilot 年付","Copilot","ai-topup","shop"),"GitHub Copilot");
  assert.equal(offerAiBrand("谷歌反重力 会员","订阅","ai-topup","shop"),"Antigravity");
  assert.equal(offerAiBrand("GeminiPro 订阅6个月 反重力可用","Gemini Pro","ai-card","shop"),"Gemini");
  assert.equal(offerAiBrand("G Plus 月卡","代充","ai-card","shop"),undefined);
  assert.equal(offerAiBrand(null,"Plus","ai-subscriptions","claude"),"Claude");
  assert.equal(offerAiBrand(null,"VPS · 支持 ChatGPT","vps","host"),undefined);
});

test("storefront identity uses the seller path and retains case-sensitive handles",()=>{
  assert.equal(storefrontIdentity("https://www.16688.com.cn/shop/s123/?ref=1#promo")?.key,"16688.com.cn/S123");
  assert.equal(storefrontIdentity("https://pay.ldxp.cn/shop/ABcd/")?.key,storefrontIdentity("https://wzyp.cn/shop/ABcd")?.key);
  assert.notEqual(storefrontIdentity("https://catfk.com/shop/ABcd")?.key,storefrontIdentity("https://catfk.com/shop/abcd")?.key);
  assert.equal(storefrontIdentity("https://www.16688.com.cn/shop/S123/product/1"),null);
});

test("original product routes distinguish hosted shops within the PriceMemo platform feed",()=>{
  assert.equal(priceMemoProductStorefront("ldxp","ShopAb","https://wzyp.cn/item/123")?.key,"wzyp.cn/ShopAb");
  assert.equal(priceMemoProductStorefront("ldxp","catfk:ShopAb","https://catfk.com/item/123")?.key,"catfk.com/ShopAb");
  assert.equal(priceMemoProductStorefront("16688","16688-S123","https://www.16688.com.cn/goods/G789")?.key,"16688.com.cn/S123");
  assert.equal(priceMemoProductStorefront("ldxp","catfk:ShopAb","https://wzyp.cn/item/123"),null);
  assert.equal(priceMemoProductStorefront("ldxp","ShopAb","https://catfk.com/item/123"),null);
  assert.equal(priceMemoProductStorefront("ldxp","ShopAb","https://wzyp.cn/shop/SomeOtherShop"),null);
});

test("multiple items of the same plan and observation time stay distinct within one store",()=>{
  using db=openDirectory(":memory:");
  const row={...make("https://wzyp.cn/shop/many-products"),sourceUrl:"https://ai.pricememo.cn/data/v1/snapshots/8889.json",
    reportedItemUrl:"https://wzyp.cn/item/product-a"};
  const [first]=importStorefronts(db,[row]);
  if("error" in first) assert.fail(first.error);
  const named={...row,offers:[{...row.offers[0],productTitle:"Plus 卡密商品 A"}]};
  const other={...row,reportedItemUrl:"https://wzyp.cn/item/product-b",offers:[{...row.offers[0],productTitle:"Plus 卡密商品 B",cnyMinor:18500}]};
  const [update,second]=importStorefronts(db,[named,other]);
  if("error" in update||"error" in second) assert.fail(JSON.stringify([update,second]));
  assert.equal(update.titles,1);
  assert.equal(second.siteId,first.siteId);
  assert.deepEqual(latestPrices(publicPrices(first.siteId,db)).map(price=>[price.product_title,price.amount_minor]),
    [["Plus 卡密商品 B",18500],["Plus 卡密商品 A",12900]]);
  assert.ok(importStorefronts(db,[named,other]).every(outcome=>!("error" in outcome)&&!outcome.prices&&!outcome.titles));
  const [history]=importStorefronts(db,[{...other,observedAt:"2026-01-04T00:00:00.000Z",offers:[{...other.offers[0],cnyMinor:19900}]}]);
  assert.ok(!("error" in history)&&history.prices===1);
  assert.equal(countPublicAiRetailProducts(db),2);
  db.prepare("UPDATE sites SET publication='archived' WHERE id=?").run(first.siteId);
  assert.equal(countPublicAiRetailProducts(db),0);
});

test("first-party product extraction keeps a public price even without seller documents or stock",()=>{
  const url="https://retail.example.com/products/chatgpt-plus";
  const product=(overrides:Record<string,unknown>={})=>`<meta property="og:site_name" content="测试 AI 小铺" />
    <script type="application/ld+json">${JSON.stringify({"@type":"Product",name:"ChatGPT Plus 月卡代充",
      offers:{"@type":"Offer",price:"108.50",priceCurrency:"CNY",url,availability:"https://schema.org/InStock",...overrides}})}</script>`;
  const seenAt="2026-01-03T00:00:00.000Z";
  const row=publicProductObservation(product(),url,seenAt);
  assert.equal(row?.name,"测试 AI 小铺");
  assert.equal(row?.sourceUrl,url);
  assert.deepEqual(row?.offers,[{plan:"ChatGPT Plus 月卡代充",cnyMinor:10850,period:"1个月",availability:"available"}]);
  assert.equal(publicProductObservation(product({availability:undefined}),url,seenAt)?.offers[0].availability,undefined);
  assert.equal(publicProductObservation(product({availability:"https://schema.org/OutOfStock"}),url,seenAt)?.offers[0].availability,"unavailable");
  assert.equal(publicProductObservation(product({priceCurrency:undefined}),url,seenAt),undefined);
  assert.equal(publicProductObservation(product({priceCurrency:"USD"}),url,seenAt),undefined);
  assert.equal(publicProductObservation(product({url:"https://other.example.net/products/cheap"}),url,seenAt),undefined);
  assert.equal(publicProductObservation(product({availability:"https://schema.org/OutOfStock"}),url,seenAt)?.offers[0].notes,"观测时缺货。");
  assert.equal(publicProductObservation(product({seller:{name:"测试 AI 小铺",url:"https://other.example.net"}}),url,seenAt),undefined);
  assert.equal(publicProductObservation(product().replace(/<meta[^>]+>/,""),url,seenAt)?.name,"retail.example.com");
});

test("directory search uses current public storefront titles and returns each shop once",()=>{
  using db=openDirectory(":memory:");
  const snapshot="https://ai.pricememo.cn/data/v1/snapshots/8889.json";
  const observation={...make("https://wzyp.cn/shop/search-merchant","星桥商店"),sourceUrl:snapshot,
    reportedItemUrl:"https://wzyp.cn/item/search-offer",offers:[{plan:"会员月卡",productTitle:"ＧＰＴ 星桥月卡",cnyMinor:3999,period:"月"}]};
  const [first,duplicate,conflicting]=importStorefronts(db,[
    observation,{...observation,reportedItemUrl:"https://wzyp.cn/item/search-offer-two"},
    {...make("https://wzyp.cn/shop/conflicting-search","海风商店"),sourceUrl:snapshot,
      reportedItemUrl:"https://wzyp.cn/item/conflicting-offer",offers:[{plan:"ChatGPT Plus",productTitle:"Grok Plus",cnyMinor:3999,period:"月"}]},
  ]);
  if("error" in first||"error" in duplicate||"error" in conflicting)assert.fail(JSON.stringify([first,duplicate,conflicting]));
  const results=listSites({q:"gpt",group:"ai-retail",size:1},db);
  assert.equal(results.total,1);
  assert.equal(results.rows[0]?.id,first.siteId);
  assert.equal(results.priceMatches.get(first.siteId)?.label,"ＧＰＴ 星桥月卡");
  assert.equal(results.priceMatches.has(conflicting.siteId),false);
  assert.equal(listSites({q:"https://wzyp.cn/item/search-offer"},db).rows[0]?.id,first.siteId);
  assert.equal(listSites({q:"发卡网",group:"ai-retail"},db).total,listSites({q:"卡网",group:"ai-retail"},db).total);
  const monthly=listSites({q:"GPT 月付 人民币",group:"ai-retail"},db);
  assert.equal(monthly.total,1);
  assert.equal(monthly.priceMatches.get(first.siteId)?.label,"ＧＰＴ 星桥月卡");
  assert.equal(listSites({q:"GPT 年付",group:"ai-retail"},db).total,0);
  assert.deepEqual(listSites({q:"Grok 会员",group:"ai-retail"},db).rows.map(({id})=>id),[conflicting.siteId]);
  assert.equal(listSites({q:"ChatGPT 会员",group:"ai-retail"},db).total,0);
  const revised={...observation,observedAt:"2026-01-04T00:00:00.000Z",offers:[{...observation.offers[0],productTitle:"新版会员月卡",cnyMinor:4000}]};
  assert.ok(importStorefronts(db,[revised,{...revised,reportedItemUrl:"https://wzyp.cn/item/search-offer-two"}]).every(row=>!("error" in row)));
  assert.equal(listSites({q:"gpt",group:"ai-retail"},db).total,0);
  assert.equal(listSites({q:"新版会员月卡",group:"ai-retail"},db).total,1);
  db.prepare("UPDATE sources SET verified=0 WHERE site_id=?").run(first.siteId);
  assert.equal(listSites({q:"新版会员月卡",group:"ai-retail"},db).total,0);
});

test("a priced subscription or account can enter the catalog with an unknown term, delivery or stock",()=>{
  const captured={original_name:"Claude 账号",currency:"CNY",price:"32.50",observed_at:"2026-01-03T03:00:00.000Z",stock_status:"out_of_stock"};
  const evidence=priceMemoVisibleOffer("Claude 账号",captured,"public-shop");
  assert.equal(visibleAiProduct("account","Claude 账号"),true);
  assert.equal(visibleAiProduct("service","Claude 接码"),false);
  assert.equal(evidence?.name,"店铺 public-shop");
  assert.equal(evidence?.category,"ai-card");
  assert.deepEqual(evidence?.offer,{plan:"Claude 账号",cnyMinor:3250,period:"周期未注明",productTitle:"Claude 账号",notes:"观测时缺货。"});
  assert.equal(priceMemoVisibleOffer("Claude 账号",{...captured,price:null},"shop"),undefined);
  assert.equal(priceMemoVisibleOffer("Claude 账号",{...captured,original_name:"补差价"},"shop"),undefined);
  assert.equal(priceMemoVisibleOffer("Claude 账号",{...captured,delivery_type:"verification_service"},"shop"),undefined);
});

test("Codex verification offers require an explicit standalone service and preserve the billing unit",()=>{
  const listing={original_name:"Codex 单次接码",delivery_type:"verification_service",currency:"CNY",price:3,
    observed_at:"2026-01-03T03:00:00.000Z"};
  assert.deepEqual(priceMemoCodexVerificationOffer(listing,"shop")?.offer,{plan:"Codex 接码",period:"每次",cnyMinor:300});
  assert.equal(priceMemoCodexVerificationOffer({...listing,original_name:"Codex 接码"},"shop")?.offer.period,"计价单位未注明");
  assert.equal(priceMemoCodexVerificationOffer({...listing,original_name:"Codex Plus 已接马"},"shop"),undefined);
  assert.equal(priceMemoCodexVerificationOffer({...listing,delivery_type:"subscription_recharge"},"shop"),undefined);
});

test("same-platform sellers are listed individually and each price retains its own source",()=>{
  const db=openDirectory(":memory:");
  try {
    const rows = [make("https://www.16688.com.cn/shop/S123","测试枫叶小铺"),make("https://www.16688.com.cn/shop/S124","测试海风小铺")];
    const items=importStorefronts(db,rows);
    if ("error" in items[0] || "error" in items[1]) assert.fail(JSON.stringify(items));
    assert.notEqual(items[0].siteId,items[1].siteId);
    const site=getSite(items[0].slug,db)!;
    assert.equal(site.status,"listed");
    assert.equal(site.hosted_storefront,1);
    assert.equal(site.review_count,0);
    assert.equal(site.product_observed_at,rows[0].observedAt);
    assert.equal(listSites({status:"product-observed"},db).total,2);
    assert.equal(directoryStats({status:"product-observed"},db).observed,2);
    assert.equal(listSites({q:"16688.com.cn/shop/S123"},db).rows[0].id,site.id);
    assert.deepEqual(publicPrices(site.id,db).map(price=>[price.amount_minor,price.source_url]),[[12900,rows[0].website]]);
    const repeated=importStorefronts(db,rows);
    assert.ok(repeated.every(item=>!("error" in item)&&!item.created&&item.prices===0));
  } finally { db.close(); }
});

test("cross-platform duplicate links resolve to one shop and require same-shop quote evidence",()=>{
  const db=openDirectory(":memory:");
  try {
    const first=make("https://catfk.com/shop/hello");
    const second=make("https://www.16688.com.cn/shop/S132");
    const outcomes=importStorefronts(db,[{...first,relatedStorefronts:[second.website]},second,
      {...make("https://catfk.com/shop/other"),sourceUrl:first.website},
      {...make("https://wzyp.cn/shop/missing"),offers:[]}]);
    if ("error" in outcomes[0] || "error" in outcomes[1]) assert.fail(JSON.stringify(outcomes));
    assert.equal(outcomes[0].siteId,outcomes[1].siteId);
    assert.ok("error" in outcomes[2] && "error" in outcomes[3]);
    assert.equal(getStorefronts(outcomes[0].siteId,db).length,2);
    const third=importStorefronts(db,[{...make("https://catfk.com/shop/alt"),observedAt:"2026-01-04T00:00:00.000Z"}])[0];
    if ("error" in third) assert.fail(JSON.stringify(third));
    mergeSites(db,third.siteId,outcomes[0].siteId,"test");
    const captured=one<{site_id:number}>(db,"SELECT site_id FROM merchant_storefronts WHERE storefront_key=?","catfk.com/alt");
    assert.equal(captured?.site_id,outcomes[0].siteId);
    assert.equal(getSite(third.slug,db),undefined);
  } finally { db.close(); }
});

test("a dated PriceMemo observation exposes both references without granting merchant verification",()=>{
  const db=openDirectory(":memory:");
  try {
    const item=make("https://www.16688.com.cn/shop/S988");
    const sourceUrl="https://ai.pricememo.cn/data/v1/snapshots/8889.json";
    const reportedItemUrl="https://www.16688.com.cn/goods/G567";
    const [valid,bad,ldxp]=importStorefronts(db,[{...item,sourceUrl,reportedItemUrl},
      {...item,website:"https://www.16688.com.cn/shop/S987",sourceUrl,reportedItemUrl:"https://catfk.com/item/123"},
      {...item,website:"https://wzyp.cn/shop/reported-shop",sourceUrl,reportedItemUrl:"https://wzyp.cn/item/456"}]);
    if ("error" in valid) assert.fail(valid.error);
    if ("error" in ldxp) assert.fail(ldxp.error);
    assert.ok("error" in bad);
    const site=getSite(valid.slug,db)!;
    assert.equal(site.status,"listed");
    assert.equal(site.reachability,"unchecked");
    const [quote]=publicPrices(site.id,db);
    assert.equal(quote.source_url,sourceUrl);
    assert.equal(quote.reported_item_url,reportedItemUrl);
    assert.equal(quote.recorded_at,item.observedAt);
    assert.throws(()=>writeEntity(db,"sites",{...site,id:site.id,aliases:"",status:"verified",verified_at:"2026-01-04"},"test"),
      /须先保存相符且已核实的来源/);
    const lease=claimRefresh(db,Date.now())!;
    assert.equal(one(db,"SELECT 1 FROM directory_refresh_targets WHERE run_id=? AND site_id=?",lease.run.id,site.id),undefined);
    assert.equal(one(db,"SELECT 1 FROM directory_refresh_targets WHERE run_id=? AND site_id=?",lease.run.id,ldxp.siteId),undefined);
    const [repeat]=importStorefronts(db,[{...item,sourceUrl,reportedItemUrl}]);
    assert.ok(!("error" in repeat)&&!repeat.created&&repeat.prices===0);
  } finally { db.close(); }
});
