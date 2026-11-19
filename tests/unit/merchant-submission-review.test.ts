import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { one,openDirectory } from "../../lib/directory/db";
import { parseMerchantReview } from "../../lib/directory/deepseek-merchant-review";
import { enrichPublishedMerchant } from "../../lib/directory/merchant-enrichment";
import { reviewNextMerchantSubmission } from "../../lib/directory/merchant-submission-review";
import { publicPrices } from "../../lib/directory/read";
import type { Visit } from "../../lib/directory/website-check";

const website="https://new-merchant-fixture.net/";
const name="青橙卡店";
const title="ChatGPT Plus 会员月卡";
const image=Buffer.from("test-only-binary-avatar");
const fixture:Visit=async url=>{
  assert.equal(url.origin,new URL(website).origin);
  const response=(body:string,contentType:string,status=200)=>({status,body,contentType,truncated:false});
  if (url.pathname==="/robots.txt") {
    return response("User-agent: *\nAllow: /api/v1/public/\nDisallow: /api/\nDisallow: /auth/\n","text/plain");
  }
  if (url.pathname==="/") return response('<div id="app"></div><script type="module" src="/assets/index.js"></script>',"text/html");
  if (url.pathname==="/api/v1/public/config") {
    return response(JSON.stringify({status_code:0,data:{brand:{site_name:name,site_icon:"/own-icon.png",site_url:website},
      currency:"CNY",storefront_template:"classic"}}),"application/json");
  }
  if (url.pathname==="/api/v1/public/products") {
    assert.equal(url.searchParams.get("page"),"1");
    return response(JSON.stringify({status_code:0,pagination:{total_page:1},data:[
      {title:{"zh-CN":title},price_amount:"28.00",stock_status:"in_stock"},
      {title:{"zh-CN":"Grok Plus 月卡"},price_amount:"61.00",stock_status:"out_of_stock"},
      {title:{"zh-CN":"教程"},price_amount:"999999999999.00",stock_status:"in_stock"},
    ]}),"application/json");
  }
  return response("not found","text/plain",404);
};

const collectAvatar:NonNullable<Parameters<typeof reviewNextMerchantSubmission>[1]>["collectAvatar"]=async (_site,page)=>{
  assert.equal(page?.icon,"/own-icon.png");
  return {avatar:{sourceUrl:website+"own-icon.png",contentType:"image/webp",image},reason:"公开标识"};
};

function submit(db:DatabaseSync,consent=1) {
  return Number(db.prepare(`INSERT INTO submissions(kind,url,body,submitted_at,merchant_name,merchant_category,publication_consent,merchant_contact)
    VALUES ('site',?,'private submission details','2026-11-19',?,'ai-card',?,'private@example.net')`)
    .run(website,name,consent).lastInsertRowid);
}

test("an authorized merchant is reviewed once and published with its own quotes and icon",async()=>{
  using db=openDirectory(":memory:",false);
  const id=submit(db);
  const unrelated=submit(db,0);
  let requests=0;
  const options:NonNullable<Parameters<typeof reviewNextMerchantSubmission>[1]>={visit:fixture,collectAvatar,review:async input=>{
    requests++;
    assert.equal(input.category,"ai-card");
    assert.equal(input.website,website);
    assert.ok(input.text.includes(title));
    assert.doesNotMatch(JSON.stringify(input),/private/);
    return {decision:"approve",evidence:title};
  }};
  const [published,concurrent]=await Promise.all([reviewNextMerchantSubmission(db,options),reviewNextMerchantSubmission(db,options)]);
  assert.equal(concurrent,undefined);
  assert.equal(published?.state,"published");
  assert.equal(requests,1);
  assert.equal(one<{moderation:string}>(db,"SELECT moderation FROM submissions WHERE id=?",id)?.moderation,"accepted");
  assert.equal(one<{moderation:string}>(db,"SELECT moderation FROM submissions WHERE id=?",unrelated)?.moderation,"pending");
  assert.equal(one<{n:number}>(db,"SELECT count(*) n FROM sites")?.n,1);
  const site=one<{id:number;slug:string}>(db,"SELECT id,slug FROM sites WHERE publication='published'")!;
  assert.deepEqual(publicPrices(site.id,db).map(price=>[price.plan,price.amount_minor]).sort(),[[title,2800],["Grok Plus 月卡",6100]]);
  assert.ok(one(db,"SELECT 1 FROM merchant_avatars WHERE site_id=? AND digest IS NOT NULL",site.id));
  assert.equal(await reviewNextMerchantSubmission(db,options),undefined);
  const refreshed=await enrichPublishedMerchant(db,site.slug,options);
  assert.deepEqual(refreshed,{slug:site.slug,checked:2,quotes:0,hasAvatar:true});
});

test("the review requires a literal source excerpt and leaves uncertain submissions for human review",async()=>{
  assert.deepEqual(parseMerchantReview('{"decision":"approve","evidence":"没有出现的套餐"}',title),{decision:"review"});
  assert.deepEqual(parseMerchantReview(JSON.stringify({decision:"approve",evidence:title}),title),{decision:"approve",evidence:title});
  using db=openDirectory(":memory:",false);
  const id=submit(db);
  const held=await reviewNextMerchantSubmission(db,{visit:fixture,review:async()=>({decision:"review"})});
  assert.equal(held?.state,"held");
  assert.equal(one<{state:string}>(db,"SELECT state FROM merchant_submission_reviews WHERE submission_id=?",id)?.state,"held");
  assert.equal(one<{n:number}>(db,"SELECT count(*) n FROM sites")?.n,0);
  assert.equal(await reviewNextMerchantSubmission(db,{visit:fixture,review:async()=>assert.fail("review was already held")}),undefined);
});

test("a manual rejection during DeepSeek review wins over automatic publication",async()=>{
  using db=openDirectory(":memory:",false);
  const id=submit(db);
  const held=await reviewNextMerchantSubmission(db,{visit:fixture,collectAvatar,review:async()=>{
    db.prepare("UPDATE submissions SET moderation='rejected' WHERE id=?").run(id);
    return {decision:"approve",evidence:title};
  }});
  assert.equal(held?.state,"held");
  assert.equal(one<{n:number}>(db,"SELECT count(*) n FROM sites")?.n,0);
});
