import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { openDirectory } from "../../lib/directory/db";
import { avatarCollector,declaredAvatarUrls,prepareAvatar } from "../../lib/directory/merchant-avatar-collection";
import { findMerchantAvatar,saveMerchantAvatar } from "../../lib/directory/merchant-avatar";
import { getSite } from "../../lib/directory/read";

test("hosted shops require a logo explicitly bound to their own shop URL",()=>{
  const page=new URL("https://shop.example.com/store/one");
  const platform='<link rel="icon" href="/platform.png"><meta property="og:image" content="/product.png">';
  const organization=(url:string)=>`<script type="application/ld+json">{"@type":"Store","url":"${url}","logo":"/logos/one.png"}</script>`;
  assert.deepEqual(declaredAvatarUrls(platform+organization("/"),page,true),[]);
  assert.deepEqual(declaredAvatarUrls(platform+organization("/store/two"),page,true),[]);
  assert.deepEqual(declaredAvatarUrls(platform+organization("/store/one"),page,true),["https://shop.example.com/logos/one.png"]);
  assert.deepEqual(declaredAvatarUrls(platform,page,false),["https://shop.example.com/platform.png","https://shop.example.com/favicon.ico"]);
  assert.deepEqual(declaredAvatarUrls('<link rel="apple-touch-icon-precomposed" href="/touch.png">',page,false),
    ["https://shop.example.com/touch.png","https://shop.example.com/favicon.ico"]);
});

test("a restricted storefront is skipped before reading its page or robots.txt",async()=>{
  const collect=avatarCollector(async()=>assert.fail("restricted source"),{restricted:()=>true});
  const result=await collect({id:1,name:"Test",slug:"test",website:"https://shop.example.com/store/one",hosted_storefront:1});
  assert.equal(result.avatar,null);
  assert.match(result.reason,/来源限制/);
});

test("avatar output is rasterized, saved with provenance, and isolated from drafts and stale websites",async()=>{
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#244e46"/></svg>';
  const image=await prepareAvatar(Buffer.from(svg));
  assert.equal(image?.contentType,"image/webp");
  assert.equal(await prepareAvatar(Buffer.from(svg.replace("<rect",'<image href="https://other.example.com/unsafe.svg"/><rect'))),null);
  assert.equal(await prepareAvatar(Buffer.from("<!doctype html><html>image not found</html>")),null);
  using db=openDirectory(":memory:");
  const site=getSite("chatgpt",db)!;
  const digest=createHash("sha256").update(image!.image).digest("hex");
  const observed="2026-01-01T00:00:00.000Z";
  const sourceUrl="https://chatgpt.com/favicon.png";
  saveMerchantAvatar(db,site,{...image!,sourceUrl},"公开标识",observed);
  saveMerchantAvatar(db,site,null,"暂时无法访问","2026-01-02T00:00:00.000Z");
  assert.equal(getSite(site.slug,db)?.avatar_digest,digest);
  assert.equal(findMerchantAvatar(db,site.slug,digest)?.content_type,"image/webp");
  assert.equal(db.prepare("SELECT source_url FROM merchant_avatars WHERE site_id=?").get(site.id)?.source_url,sourceUrl);
  db.prepare("UPDATE sites SET website='https://new.example.com' WHERE id=?").run(site.id);
  assert.equal(getSite(site.slug,db)?.avatar_digest,null);
  assert.equal(findMerchantAvatar(db,site.slug,digest),undefined);
  db.prepare("UPDATE sites SET website=?,publication='archived' WHERE id=?").run(site.website,site.id);
  assert.equal(findMerchantAvatar(db,site.slug,digest),undefined);
});
