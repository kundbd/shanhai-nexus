import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDirectory } from "../../lib/directory/db";
import { getCategory, getSite, listSites, publicEditorials } from "../../lib/directory/read";
import { saveVisibility } from "../../lib/geo/admin";
import { identifyAudience, nginxVisitorAddress } from "../../lib/geo/lookup";
import { allowsRegion, makeAudience } from "../../lib/geo/policy";
import { regionDisplay } from "../../lib/geo/region-display";
import { loadVisibility } from "../../lib/geo/visibility";

test("any identified location outside mainland China uses the overseas preset", () => {
  const cn=makeAudience("CN");
  const overseas={mode:"overseas",countries:[]} as const;
  for (const country of ["HK","MO","TW","US","SG","DE","AU","BR","ZA"]) {
    assert.equal(allowsRegion(overseas,makeAudience(country)),true);
  }
  assert.equal(allowsRegion(overseas,cn),false);
  assert.deepEqual(makeAudience(undefined),cn);
  assert.deepEqual(makeAudience("XX"),cn);
  assert.equal(allowsRegion({mode:"countries",countries:["US"]},makeAudience("US")),true);
  assert.equal(allowsRegion({mode:"countries",countries:["US"]},makeAudience("HK")),false);
  assert.equal(allowsRegion(overseas,"universal"),false);
});

test("header labels include the requested flags and keep other areas generic", () => {
  for (const [country,label,flag] of [
    ["CN","中国大陆","cn"],["HK","中国香港","hk"],["TW","中国台湾","cn"],["MO","中国澳门","mo"],
    ["SG","新加坡","sg"],["DE","德国","de"],["US","美国","us"],["CA","加拿大","ca"],["MX","墨西哥","mx"],
  ]) {
    assert.equal(regionDisplay(country).label,label);
    assert.equal(regionDisplay(country).flag?.code,flag);
  }
  assert.deepEqual(regionDisplay("TW").flag,regionDisplay("CN").flag);
  for (const country of ["AU","ZA","BR"]) assert.deepEqual(regionDisplay(country),{label:"其他区域"});
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
  const hk=loadVisibility(db,makeAudience("HK"));
  const us=loadVisibility(db,makeAudience("US"));
  const cn=loadVisibility(db,makeAudience("CN"));
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

test("the overseas rollout restores only records archived by the original retirement", () => {
  using db=openDirectory(":memory:");
  const recordRetirement=db.prepare(`INSERT INTO audit_log(actor,action,entity,entity_id,before_json,after_json,created_at)
    SELECT '目录维护','archive','sites',CAST(id AS TEXT),json_object('slug',slug,'publication','published'),
      json_object('slug',slug,'publication','archived'),'2026-11-18' FROM sites WHERE slug=?`);
  for (const slug of ["proton-vpn","mullvad","tailscale"]) assert.equal(recordRetirement.run(slug).changes,1);
  db.exec(`INSERT INTO audit_log(actor,action,entity,entity_id,after_json,created_at)
    SELECT 'editor','archive','sites',CAST(id AS TEXT),json_object('publication','archived'),'2026-11-19' FROM sites WHERE slug='mullvad';
    INSERT INTO sites(slug,name,website,category_slug,summary,publication,added_at,updated_at)
    VALUES ('network-never-published','Never Published','https://example.net/','vpn','Sample archive','archived','2026-11-19','2026-11-19');`);
  const migration=readFileSync("lib/directory/migrations/044-overseas-network-publication.sql","utf8");
  db.exec(migration);
  db.exec(migration);
  const reopened=db.prepare("SELECT s.slug FROM sites s JOIN audit_log a ON a.entity_id=CAST(s.id AS TEXT) WHERE a.actor='地区设置' AND a.entity='sites' ORDER BY s.slug").all();
  assert.deepEqual(reopened.map(row=>row.slug),["proton-vpn","tailscale"]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM content_region_rules").get()?.n,3);
  for (const country of ["HK","TW","US","SG","DE","AU"]) {
    const visibility=loadVisibility(db,makeAudience(country));
    assert.ok(getCategory("vpn",db,visibility));
    assert.ok(getSite("proton-vpn",db,visibility));
    assert.ok(getSite("tailscale",db,visibility));
    assert.equal(getSite("mullvad",db,visibility),undefined);
    assert.equal(getSite("network-never-published",db,visibility),undefined);
  }
  for (const audience of [makeAudience("CN"),makeAudience(undefined),"universal"] as const) {
    const visibility=loadVisibility(db,audience);
    assert.equal(getSite("proton-vpn",db,visibility),undefined);
    assert.equal(getSite("tailscale",db,visibility),undefined);
  }
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
