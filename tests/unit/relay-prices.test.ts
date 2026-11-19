import assert from "node:assert/strict";
import test from "node:test";
import { one,openDirectory } from "../../lib/directory/db";
import { parseExchangeRates,saveExchangeRates } from "../../lib/directory/exchange-rates";
import { publicPriceBoard } from "../../lib/directory/price-board";
import { groupRelayModels,relayModelKey,relayVersionLabel } from "../../lib/directory/relay-models";
import { importRelayPricing } from "../../lib/directory/relay-price-import";
import { listSites,publicPrices } from "../../lib/directory/read";

test("relay import groups the same exact model and direction and preserves original price precision",()=>{
  using db=openDirectory(":memory:");
  const rates='<Cube time="2026-01-02"><Cube currency="CNY" rate="8"/><Cube currency="USD" rate="1"/></Cube>';
  assert.equal(parseExchangeRates(rates).rates.get("CNY"),8);
  saveExchangeRates(db,rates);
  const batch={observed:"2026-01-02",merchants:[
    {name:"OpenRouter",slug:"openrouter",website:"https://openrouter.ai/",summary:"API 网关测试资料",
      sources:[{url:"https://openrouter.ai/models",note:"基础价",rates:[["模型 A","USD","0.269","0.4"],["模型 B","USD","0.3","0.8"]]}]},
    {name:"样本站",slug:"relay-fixture",website:"https://shanhai-relay.net/",summary:"可核对的 API 网关测试资料",
      sources:[{url:"https://shanhai-relay.net/pricing",note:"基础价",rates:[["模型 A","CNY","2.151","5"]],plans:[["Starter","CNY","20"]]}]},
  ]} as const;
  assert.deepEqual(importRelayPricing(db,batch),{added:1,reclassified:0,existing:1,priced:2,quotes:7,skipped:[]});
  assert.equal(importRelayPricing(db,batch).quotes,0);
  const groups=publicPriceBoard(db).groups.filter(group=>group.category==="ai-relay");
  const inputs=groups.find(group=>group.period==="每百万输入 Token"&&group.subcategory==="模型 A")!;
  assert.equal(inputs.merchants,2);
  assert.deepEqual(inputs.quotes.map(({site_name,amount_scale})=>[site_name,amount_scale]),[["样本站",6],["OpenRouter",6]]);
  assert.equal(inputs.quotes[1].cny_amount,2.152);
  assert.equal(groups.find(group=>group.period==="每百万输出 Token"&&group.subcategory==="模型 A")?.quotes[1].cny_amount,5);
  assert.equal(groups.find(group=>group.period==="月")?.quotes[0].plan,"Starter");
});

test("public pages are published without merchant verification and pricing follows its evidence",()=>{
  using db=openDirectory(":memory:");
  const batch={observed:"2026-01-02",merchants:[
    {name:"无公开价格",slug:"example-host",website:"https://example-host.net/",summary:"公开 VPS 产品页面。",category:"vps",
      sources:[{url:"https://example-host.net/",note:"有服务介绍。"}]},
    {name:"有公开价格",slug:"price-vps",website:"https://price-vps.net/",summary:"公开服务器价目。",category:"vps",
      sources:[{url:"https://price-vps.net/plans",note:"公开价格表。",plans:[["基础套餐","CNY","16","月付"]]}]},
  ]} as const;
  assert.equal(importRelayPricing(db,batch).added,2);
  assert.equal(importRelayPricing(db,batch).quotes,0);
  const plain=listSites({q:"example-host.net",status:"unpriced"},db).rows[0]!;
  const priced=listSites({q:"price-vps.net",status:"priced"},db).rows[0]!;
  assert.equal(plain.status,"listed");
  assert.equal(priced.status,"listed");
  assert.equal(publicPrices(priced.id,db).length,1);
  assert.equal(publicPriceBoard(db).groups.filter(group=>group.category==="vps").some(group=>group.quotes.some(q=>q.site_id===priced.id)),true);
  assert.equal(one<{basis:string}>(db,"SELECT basis FROM sites WHERE id=?",priced.id)?.basis,"standard");
});

test("relay model aliases share a quote group while distinct versions retain independent prices",()=>{
  using db=openDirectory(":memory:");
  importRelayPricing(db,{observed:"2026-01-02",merchants:[{
    name:"OpenRouter",slug:"openrouter",website:"https://openrouter.ai/",summary:"公开的模型测试价目",
    sources:[{url:"https://openrouter.ai/models",note:"基础价",rates:[
      ["DeepSeek V4 Pro","CNY","9","27"],
      ["deepseek-v4-pro","CNY","9","27"],
      ["DeepSeek V4 Pro 0813","CNY","12","24"],
      ["GPT-OSS 120B","CNY","1","2"],
    ]}],
  }]});
  const inputs=publicPriceBoard(db).groups.filter(group=>group.category==="ai-relay"&&group.period==="每百万输入 Token");
  assert.equal(inputs.length,3);
  const base=inputs.find(group=>group.subcategory==="DeepSeek V4 Pro")!;
  const latest=inputs.find(group=>group.subcategory==="DeepSeek V4 Pro 0813")!;
  assert.deepEqual(base.quotes.map(quote=>quote.cny_amount),[9]);
  assert.deepEqual(latest.quotes.map(quote=>quote.cny_amount),[12]);
  assert.equal(relayModelKey(" DEEPSEEK_V4‐PRO "),relayModelKey(base.subcategory!));
  assert.deepEqual(groupRelayModels([base.subcategory!,latest.subcategory!,"GPT-OSS 120B"]),[
    {brand:"DeepSeek",versions:["DeepSeek V4 Pro","DeepSeek V4 Pro 0813"]},
    {brand:"OpenAI",versions:["GPT-OSS 120B"]},
  ]);
  assert.equal(relayVersionLabel(latest.subcategory!,"DeepSeek"),"V4 Pro 0813");
});

test("model searches find exact relay quotes without bringing in other GPT versions",()=>{
  using db=openDirectory(":memory:");
  const vendors=[
    {name:"图书网关",slug:"library-gateway",website:"https://library-gateway.net/",model:"GPT-5.5"},
    {name:"转接实验室",slug:"relay-laboratory",website:"https://relay-laboratory.net/",model:"GPT-5.2"},
    {name:"另一个版本",slug:"other-version",website:"https://other-version.net/",model:"GPT-5.50"},
  ];
  importRelayPricing(db,{observed:"2026-01-02",merchants:vendors.map(({model,...vendor})=>({...vendor,
    summary:"中转服务公开模型价目。",sources:[{url:`${vendor.website}pricing`,note:"公开报价。",rates:[[model,"USD","5","30"]]}],
  }))});
  const exact=listSites({q:"GPT-5.5",category:"ai-relay"},db);
  assert.deepEqual(exact.rows.map(site=>site.slug),["library-gateway"]);
  assert.equal(exact.priceMatches.get(exact.rows[0].id)?.label,"GPT-5.5");
  for (const q of ["ＧＰＴ５.５ 每百万输出 Token","gpt-5.5 output per 1M tokens 美元"]) {
    const matches=listSites({q,category:"ai-relay"},db);
    assert.deepEqual(matches.rows.map(site=>site.slug),["library-gateway"],q);
    assert.equal(matches.priceMatches.get(matches.rows[0].id)?.label,"GPT-5.5");
  }
  assert.equal(listSites({q:"GPT-5.5 每百万输出 Token 人民币",category:"ai-relay"},db).total,0);
  const first=listSites({q:"gpt",category:"ai-relay",size:1},db);
  const second=listSites({q:"gpt",category:"ai-relay",size:1,page:2},db);
  assert.equal(first.total,3);
  assert.equal(second.total,first.total);
  assert.notEqual(first.rows[0].id,second.rows[0].id);
});
