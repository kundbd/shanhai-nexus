import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openDirectory } from "../../lib/directory/db";
import { getPublicProduct,productHref,productKey } from "../../lib/directory/products";
import { productRanking,shopRanking } from "../../lib/directory/rankings";
import { getSite,latestPrices,publicPrices } from "../../lib/directory/read";
import { importStorefronts } from "../../lib/directory/storefront-import";
import { recordPageVisitor,trafficReport } from "../../lib/directory/traffic";
import { siteHref } from "../../lib/directory/types";

test("shop and product rankings count distinct recent browsers in their own categories and retain product identity across price changes",()=>{
  using db=openDirectory(":memory:");
  const time=Date.UTC(2026,10,18,4);
  const [alice,bob,carol]=[randomUUID(),randomUUID(),randomUUID()];
  const shop=(id:string,name:string,cnyMinor:number,observedAt="2026-01-03T00:00:00.000Z")=>({
    name,website:`https://wzyp.cn/shop/${id}`,sourceUrl:`https://wzyp.cn/shop/${id}`,observedAt,category:"ai-topup" as const,
    offers:[{plan:"ChatGPT Plus 月卡",period:"1个月",cnyMinor},{plan:"ChatGPT Plus 年卡",period:"1年",cnyMinor:59900}],
  });
  const [first,second]=importStorefronts(db,[shop("rankA","测试店铺甲",10200),shop("rankB","测试店铺乙",9700)]);
  if ("error" in first||"error" in second) assert.fail("fixture storefronts were not imported");
  const host=getSite("digitalocean",db)!;
  const hostPrice=latestPrices(publicPrices(host.id,db))[0];
  assert.ok(hostPrice);
  const oneMonth=latestPrices(publicPrices(first.siteId,db)).find(price=>price.period==="1个月")!;
  const oneYear=latestPrices(publicPrices(first.siteId,db)).find(price=>price.period==="1年")!;
  const otherStore=latestPrices(publicPrices(second.siteId,db)).find(price=>price.period==="1个月")!;
  assert.notEqual(productHref(oneMonth),productHref(oneYear));
  assert.notEqual(productHref(oneMonth),productHref(otherStore));
  const firstShop=siteHref(first.slug);
  const secondShop=siteHref(second.slug);
  const hostShop=siteHref(host.slug);
  const monthly=productHref(oneMonth);
  for (const [path,visitor] of [[firstShop,alice],[firstShop,alice],[firstShop,bob],[secondShop,bob],
    [hostShop,carol],[productHref(hostPrice),carol],[monthly,carol],[monthly,carol],[monthly,bob],[productHref(oneYear),alice],[productHref(otherStore),bob]]) {
    assert.equal(recordPageVisitor(db,path,visitor,time),true,path);
  }
  assert.equal(recordPageVisitor(db,monthly,alice,time-86_400_000),true);
  assert.equal(recordPageVisitor(db,`${monthly}?q=private`,alice,time),false);
  assert.equal(recordPageVisitor(db,`/products/${first.siteId}/${"0".repeat(32)}`,alice,time),false);
  assert.deepEqual(shopRanking(db,"ai-retail","24h",time).map(row=>[row.id,row.visitors]),[[first.siteId,2],[second.siteId,1]]);
  assert.deepEqual(shopRanking(db,"vps","24h",time).map(row=>[row.id,row.visitors]),[[host.id,1]]);
  assert.deepEqual(shopRanking(db,"payments","24h",time),[]);
  assert.deepEqual(productRanking(db,"ai-retail","24h",time).map(row=>[row.visitors,row.price.id]).sort((a,b)=>b[0]-a[0]||a[1]-b[1]),
    [[2,oneMonth.id],...[oneYear.id,otherStore.id].sort((a,b)=>a-b).map(id=>[1,id])]);
  assert.deepEqual(productRanking(db,"vps","24h",time).map(row=>[row.price.id,row.visitors]),[[hostPrice.id,1]]);
  assert.equal(trafficReport(db,time).pages.find(row=>row.page===monthly)?.title,oneMonth.plan);
  assert.equal(trafficReport(db,time).total,3);

  const [change]=importStorefronts(db,[shop("rankA","测试店铺甲",10800,"2026-01-04T00:00:00.000Z")]);
  assert.ok(!("error" in change)&&change.prices===1);
  const updated=getPublicProduct(db,first.siteId,productKey(oneMonth))!;
  assert.notEqual(updated.id,oneMonth.id);
  assert.equal(updated.amount_minor,10800);
  assert.equal(productHref(updated),monthly);
  assert.deepEqual(productRanking(db,"ai-retail","24h",time).slice(0,1).map(row=>[row.price.id,row.visitors]),[[updated.id,2]]);
  assert.deepEqual(productRanking(db,"ai-retail","overall").slice(0,1).map(row=>[row.price.id,row.visitors]),[[updated.id,3]]);

  db.prepare("UPDATE price_records SET publication='draft' WHERE site_id=? AND period='1个月'").run(first.siteId);
  db.prepare("UPDATE sites SET lifecycle='closed' WHERE id=?").run(second.siteId);
  assert.equal(recordPageVisitor(db,monthly,bob,time),false);
  assert.equal(recordPageVisitor(db,productHref(otherStore),bob,time),false);
  assert.deepEqual(productRanking(db,"ai-retail","24h",time).map(row=>row.price.id),[oneYear.id]);
  assert.deepEqual(shopRanking(db,"ai-retail","24h",time).map(row=>row.id),[first.siteId]);
  const tomorrow=time+86_400_000;
  assert.deepEqual(shopRanking(db,"ai-retail","24h",tomorrow),[]);
  assert.deepEqual(productRanking(db,"ai-retail","24h",tomorrow),[]);
  assert.deepEqual(shopRanking(db,"ai-retail","overall").map(row=>[row.id,row.visitors]),[[first.siteId,2]]);
  assert.deepEqual(productRanking(db,"ai-retail","overall").map(row=>[row.price.id,row.visitors]),[[oneYear.id,1]]);
  assert.equal(recordPageVisitor(db,firstShop,alice,tomorrow),true);
  assert.equal(recordPageVisitor(db,productHref(oneYear),alice,tomorrow),true);
  assert.deepEqual(shopRanking(db,"ai-retail","24h",tomorrow).map(row=>row.visitors),[1]);
  assert.deepEqual(shopRanking(db,"ai-retail","overall").map(row=>row.visitors),[2]);
  assert.deepEqual(productRanking(db,"ai-retail","24h",tomorrow).map(row=>row.visitors),[1]);
  assert.deepEqual(productRanking(db,"ai-retail","overall").map(row=>row.visitors),[1]);
});

test("cumulative ranking migration seeds available detail-page visitors and skips expired or unrelated data",()=>{
  using db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE traffic_visitors(page TEXT,visitor_hash BLOB,last_seen INTEGER,PRIMARY KEY(page,visitor_hash)) STRICT");
  const minute=Math.floor(Date.now()/60_000);
  const shop="/services/ranking-fixture";
  const product=`/products/17/${"a".repeat(32)}`;
  const add=db.prepare("INSERT INTO traffic_visitors VALUES (?,?,?)");
  add.run(shop,Buffer.alloc(32,1),minute-1);
  add.run(shop,Buffer.alloc(32,2),minute-10);
  add.run(shop,Buffer.alloc(32,3),minute-1440);
  add.run(product,Buffer.alloc(32,4),minute);
  for (const path of ["","/services","/search","/rankings","/community/posts/1"]) add.run(path,Buffer.alloc(32,5),minute);
  db.exec(readFileSync("lib/directory/migrations/036-ranking-visitors.sql","utf8"));
  assert.deepEqual(db.prepare("SELECT page,visitors FROM ranking_pages ORDER BY page").all().map(row=>[row.page,row.visitors]),
    [[product,1],[shop,2]]);
  assert.equal(db.prepare("SELECT count(*) n FROM ranking_visitors").get()?.n,3);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
});
