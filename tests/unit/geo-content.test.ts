import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDirectory } from "../../lib/directory/db";
import { getCategory, getSite, listSites, publicEditorials } from "../../lib/directory/read";
import { saveVisibility } from "../../lib/geo/admin";
import { identifyAudience, nginxVisitorAddress } from "../../lib/geo/lookup";
import { allowsRegion, makeAudience } from "../../lib/geo/policy";
import { loadVisibility } from "../../lib/geo/visibility";

test("country matching uses the effective CN fallback and an explicit overseas allowlist", () => {
  const hk=makeAudience("HK","");
  const us=makeAudience("US","");
  const cn=makeAudience("CN","US,CN");
  const overseas={mode:"overseas",countries:[]} as const;
  assert.equal(allowsRegion(overseas,hk),true);
  assert.equal(allowsRegion(overseas,us),false);
  assert.equal(allowsRegion(overseas,makeAudience("US","US")),true);
  assert.equal(allowsRegion(overseas,cn),false);
  assert.deepEqual(makeAudience("XX","US"),cn);
  assert.equal(allowsRegion({mode:"countries",countries:["US"]},us),true);
  assert.equal(allowsRegion(overseas,"universal"),false);
});

test("direct Nginx mode reads the connection appended on the right", () => {
  const forwarded=new Headers({
    "x-forwarded-for":"203.198.23.1, 8.8.8.8, 114.114.114.114",
    "cf-ipcountry":"HK","x-real-ip":"203.198.23.1","forwarded":"for=203.198.23.1",
  });
  assert.equal(nginxVisitorAddress(forwarded),"114.114.114.114");
  forwarded.set("x-forwarded-for","203.198.23.1, ::ffff:8.8.8.8");
  assert.equal(nginxVisitorAddress(forwarded),"8.8.8.8");
  for (const address of ["127.0.0.1","::1","10.0.0.1","2001:db8::1","bad", ""]) {
    forwarded.set("x-forwarded-for",`203.198.23.1, ${address}`);
    assert.equal(nginxVisitorAddress(forwarded),undefined);
  }
  forwarded.delete("x-forwarded-for");
  assert.equal(nginxVisitorAddress(forwarded),undefined);
});

test("a missing or invalid country database preserves the basic audience", async () => {
  const before=Object.fromEntries(["NODE_ENV","HOSTNAME","GEO_IP_MODE","GEO_IP_DB"].map(key=>[key,process.env[key]]));
  const directory=await mkdtemp(join(tmpdir(),"shanhai-geo-"));
  const bad=join(directory,"invalid.mmdb");
  await writeFile(bad,"invalid country database");
  const headers=new Headers({"x-forwarded-for":"8.8.8.8","cf-ipcountry":"US"});
  try {
    Object.assign(process.env,{NODE_ENV:"production",HOSTNAME:"127.0.0.1",GEO_IP_MODE:"nginx-direct"});
    for (const path of [join(directory,"missing.mmdb"),bad]) {
      process.env.GEO_IP_DB=path;
      assert.equal((await identifyAudience(headers)).country,"CN");
    }
  } finally {
    for (const [key,value] of Object.entries(before)) {
      if (value===undefined) delete process.env[key];
      else process.env[key]=value;
    }
    await unlink(bad);
    await rmdir(directory);
  }
});

test("explicit category and site rules permit regional publication without reviving archived stores", () => {
  using db=openDirectory(":memory:");
  const set=(kind:string,key:string,mode:string,countries="")=>saveVisibility(db,{kind,key,mode,countries},"fixture");
  const publish=db.prepare("UPDATE sites SET publication='published' WHERE slug=?");
  assert.throws(()=>publish.run("proton-vpn"),/无法发布/);
  assert.throws(()=>set("site","proton-vpn","countries","CN, HK"),/只能配置境外/);
  assert.throws(()=>set("ad","gate","countries","ZZ"),/有效/);
  set("category","vpn","overseas");
  assert.throws(()=>publish.run("proton-vpn"),/无法发布/);
  set("site","proton-vpn","countries","HK");
  publish.run("proton-vpn");
  const hk=loadVisibility(db,makeAudience("HK","US"));
  const us=loadVisibility(db,makeAudience("US","US"));
  const cn=loadVisibility(db,makeAudience("CN","US"));
  assert.ok(getCategory("vpn",db,hk));
  assert.equal(getCategory("vpn",db,cn),undefined);
  assert.ok(getSite("proton-vpn",db,hk));
  assert.equal(getSite("mullvad",db,hk),undefined);
  assert.equal(getSite("proton-vpn",db,us),undefined);
  assert.equal(listSites({q:"proton-vpn",visibility:cn},db).total,0);
  assert.ok(listSites({q:"proton-vpn",visibility:hk},db).total>0);
  assert.equal(getSite("proton-vpn",db,loadVisibility(db,"universal")),undefined);
  set("category","vpn","all");
  assert.equal(getSite("proton-vpn",db,loadVisibility(db,makeAudience("HK"))),undefined);
  assert.equal(db.prepare("SELECT publication FROM sites WHERE slug='proton-vpn'").get()?.publication,"published");
});

test("child content obeys parent regions and promotion rules use a stable URL key", () => {
  using db=openDirectory(":memory:");
  const set=(kind:string,key:string,mode:string,countries="")=>saveVisibility(db,{kind,key,mode,countries},"fixture");
  set("category","ai","countries","HK");
  set("editorial","chatgpt-observation","countries","US");
  set("promotion","https://promo.example.com/?b=2&a=1","cn");
  const cn=loadVisibility(db,makeAudience("CN"));
  const hk=loadVisibility(db,makeAudience("HK"));
  const us=loadVisibility(db,makeAudience("US"));
  assert.equal(getSite("chatgpt",db,cn),undefined);
  assert.ok(getSite("chatgpt",db,hk));
  assert.ok(!publicEditorials(undefined,100,db,hk).some(item=>item.slug==="chatgpt-observation"));
  assert.ok(!publicEditorials(undefined,100,db,us).some(item=>item.slug==="chatgpt-observation"));
  assert.equal(cn.linkAllowed("https://promo.example.com/?a=1&b=2"),true);
  assert.equal(hk.linkAllowed("https://promo.example.com/?a=1&b=2"),false);
  assert.equal(hk.filterText("入口 https://promo.example.com/?a=1&b=2"),"入口 ");
});
