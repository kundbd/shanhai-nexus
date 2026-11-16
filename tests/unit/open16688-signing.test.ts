import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { open16688SigningText, signedOpen16688Params } from "../../lib/directory/open16688-signing";

test("16688 canonical text matches the documented scalar and nested JSON rules",()=>{
  const signedText = open16688SigningText("/openApi/goodsCategory/list",{
    unset:null, timestamp:1710000000, tags:[], sign:"ignored", nonce:"0123456789abcdef",
    filters:{z:{b:null,a:"中文/商品"},a:[0,{},false]}, enabled:false, empty:"", app_id:"test-app-id",
  });
  const expected = [
    "POST","goodscategory","list",
    'app_id=test-app-id&empty=&enabled=false&filters={"a":[0,{},false],"z":{"a":"中文/商品","b":null}}&nonce=0123456789abcdef&tags=[]&timestamp=1710000000&unset=',
  ].join("\n");
  assert.equal(signedText,expected);
  assert.equal(createHmac("sha256","test-signing-secret").update(signedText).digest("hex"),
    "6c8d61eef7bfd99742cee21e45836814028cfe8fe3ea79987ae693fbd36cddb4");
});

test("16688 request builder generates a fresh nonce and signs only the request fields",()=>{
  const path="/openApi/goods/list";
  const options={ page_no:1,page_size:5,keywords:"Claude Plus / 月付" };
  const creds={ appId:"test-app-id",secret:"test-signing-secret" };
  const first=signedOpen16688Params(path,options,creds,1710000000580);
  const second=signedOpen16688Params(path,options,creds,1710000000580);
  assert.equal(first.timestamp,"1710000000");
  assert.match(first.nonce,/^[0-9a-f]{32}$/);
  assert.notEqual(first.nonce,second.nonce);
  assert.match(first.sign,/^[0-9a-f]{64}$/);
  assert.equal(first.sign,createHmac("sha256",creds.secret).update(open16688SigningText(path,first)).digest("hex"));
  assert.equal(Object.hasOwn(first,"secret"),false);
  assert.throws(()=>signedOpen16688Params(path,{nonce:"fixed"},creds),/不能覆盖认证字段/);
  assert.throws(()=>open16688SigningText("/openApi/goods/list?test=true",first),/路径/);
});
