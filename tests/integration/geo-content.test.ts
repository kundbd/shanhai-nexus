import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { homeAds } from "../../lib/catalog/home-ads";
import {
  editorialMarker, editorialSlug, hiddenArticle, hiddenGuide, hiddenSite, hiddenSiteName,
  networkName, networkSite, offerMarker, startGeoStaging,
} from "../fixtures/geo-staging";

const guide=`/guides/${hiddenGuide}`;
const article=`/guides/${hiddenArticle}`;
const shop=`/services/${hiddenSite}`;
const network=`/services/${networkSite}`;
const editorial=`/observations/${editorialSlug}`;
const gate=homeAds.find(item=>item.id==="gate")!;
const roogoo=homeAds.find(item=>item.id==="roogoo")!;

test("production standalone region policies through a trusted local proxy", {timeout:120_000}, async t=>{
  const fixture=await startGeoStaging();
  t.after(fixture.close);
  const {origin,content,setRegion}=fixture;
  const fetchPage=(path:string,init?:RequestInit)=>fetch(origin+path,{signal:AbortSignal.timeout(9_000),...init});
  const get=async (path:string,init?:RequestInit)=>{
    const response=await fetchPage(path,init);
    return {response,body:await response.text()};
  };
  const assertNoStore=(response:Response)=>{
    assert.match(response.headers.get("cache-control")??"",/\bprivate\b/);
    assert.match(response.headers.get("cache-control")??"",/\bno-store\b/);
  };
  const absent=(body:string,...values:string[])=>{
    for (const value of values) assert.ok(!body.includes(value),`Restricted text found: ${value}`);
  };
  const regionLabel=(body:string,label:string)=>{
    const footer=/<footer[\s\S]*?<\/footer>/.exec(body)?.[0]??"";
    assert.ok(footer.replace(/<!--[\s\S]*?-->/g,"").includes("当前内容地区："+label),`Expected the footer region ${label}`);
  };

  await t.test("CN home, categories, guides and navigation",async ()=>{
    setRegion("CN");
    const home=await get("/");
    assert.equal(home.response.status,200);
    regionLabel(home.body,"中国大陆");
    absent(home.body,hiddenSiteName,networkName,"/categories/vpn",gate.href,content.promotion);
    assert.ok(home.body.includes(roogoo.href));
    assert.ok((await get("/guides")).body.includes(article));
    absent((await get("/guides")).body,`href="${guide}"`);
    absent((await get("/services?group=all")).body,hiddenSiteName,networkName,"/categories/vpn");
  });

  await t.test("HK content and restricted category",async ()=>{
    setRegion("HK");
    const home=await get("/");
    regionLabel(home.body,"香港");
    assert.ok(home.body.includes("/categories/vpn"));
    assert.ok(home.body.includes(hiddenSiteName));
    assert.ok(home.body.includes(gate.href.replaceAll("&","&amp;")));
    absent(home.body,content.promotion);
    const category=await get("/categories/vpn");
    assert.equal(category.response.status,200);
    assert.ok(category.body.includes(networkName));
    assert.match(category.body,/name="robots" content="noindex/);
    assert.equal((await get(editorial)).response.status,404);
    assert.equal((await get("/services/mullvad")).response.status,404);
  });

  await t.test("US per-country inclusion and the configured overseas preset",async ()=>{
    setRegion("US");
    const home=await get("/");
    regionLabel(home.body,"其他地区");
    assert.ok(home.body.includes(content.promotion.replaceAll("&","&amp;")));
    assert.equal((await get(network)).response.status,200);
    const approved=await get(editorial);
    assert.ok(approved.body.includes(editorialMarker));
    assert.match(approved.body,/name="robots" content="noindex/);
    assert.equal((await get(guide)).response.status,404);
    assert.equal((await get(article)).response.status,404);
    assert.equal((await get(shop)).response.status,404);
    assert.ok((await get("/services/chatgpt")).body.includes("GeoCheckPromotionSource"));
  });

  await t.test("unknown IP falls back to CN and public headers do not choose a region",async ()=>{
    const claimed={"CF-IPCountry":"HK","CF-Connecting-IP":"203.198.23.1",
      "X-Real-IP":"203.198.23.1","X-Forwarded-For":"203.198.23.1, 8.8.8.8","Forwarded":"for=203.198.23.1"};
    for (const country of ["CN","unknown"] as const) {
      setRegion(country);
      const home=await get("/",{headers:claimed});
      regionLabel(home.body,"中国大陆");
      absent(home.body,hiddenSiteName,gate.href,content.promotion);
      const denied=await get(shop+"?region=HK&country=US",{headers:claimed});
      assert.equal(denied.response.status,404);
      absent(denied.body,hiddenSiteName);
    }
    setRegion("HK");
    assert.equal((await get(shop,{headers:{"X-Forwarded-For":"114.114.114.114","CF-IPCountry":"CN"}})).response.status,200);
  });

  await t.test("direct HTML, product, category, editorial, review and avatar links",async ()=>{
    setRegion("CN");
    for (const path of [guide,shop,network,editorial,"/categories/vpn",content.product,content.thread]) {
      const result=await get(path);
      assert.equal(result.response.status,404,path);
      assert.match(result.body,/在当前内容地区暂未开放/);
      absent(result.body,hiddenSiteName,networkName,editorialMarker,offerMarker,"GeoCheckReviewMarker","如何定位 JSON 语法错误");
      assertNoStore(result.response);
    }
    assert.equal((await fetchPage(content.avatar)).status,404);
    absent((await get("/services/chatgpt")).body,"GeoCheckPromotionSource",content.promotion);
    setRegion("HK");
    for (const path of [guide,shop,network,content.product,content.thread,content.avatar]) {
      const allowed=await get(path);
      assert.equal(allowed.response.status,200,path);
      assertNoStore(allowed.response);
    }
    const icon=await get(content.avatar);
    assert.equal(icon.body,"regional test icon");
    setRegion("CN");
    assert.equal((await fetchPage(content.avatar,{headers:{"If-None-Match":icon.response.headers.get("etag")!}})).status,404);
  });

  await t.test("search, related links, price calculations and rankings use the same scope",async ()=>{
    const query=(value:string,type:string)=>`/search?${new URLSearchParams({q:value,type})}`;
    setRegion("CN");
    absent((await get(query("JSON 语法错误","guide"))).body,`href="${guide}"`);
    absent((await get(query(hiddenSiteName,"service"))).body,`href="${shop}"`);
    absent((await get(query(editorialMarker,"observation"))).body,`href="${editorial}"`);
    absent((await get("/tools/json")).body,`href="${guide}"`);
    absent((await get("/?price=vps")).body,offerMarker,hiddenSiteName);
    absent((await get("/rankings?group=vps&period=overall")).body,hiddenSiteName);
    absent((await get("/community?view=reviews")).body,hiddenSiteName,"GeoCheckReviewMarker");
    setRegion("HK");
    assert.ok((await get(query("JSON 语法错误","guide"))).body.includes(`href="${guide}"`));
    assert.ok((await get(query(hiddenSiteName,"service"))).body.includes(`href="${shop}"`));
    assert.ok((await get("/tools/json")).body.includes(`href="${guide}"`));
    assert.ok((await get("/?price=vps")).body.includes(offerMarker));
    assert.ok((await get("/rankings?group=vps&period=overall")).body.includes(hiddenSiteName));
    assert.ok((await get("/community?view=reviews")).body.includes("GeoCheckReviewMarker"));
  });

  await t.test("one conservative sitemap for every country",async ()=>{
    const sitemaps=[];
    for (const country of ["CN","HK","US","unknown"] as const) {
      setRegion(country);
      const result=await get("/sitemap.xml");
      assert.equal(result.response.status,200);
      assertNoStore(result.response);
      assert.ok(result.body.includes("/guides/unix-time"));
      absent(result.body,guide,article,shop,network,editorial,"/categories/vpn");
      sitemaps.push(result.body);
    }
    assert.equal(new Set(sitemaps).size,1);
  });

  await t.test("cached responses and RSC payloads cannot cross regions",async ()=>{
    setRegion("HK");
    const allowed=await get(guide);
    assert.equal(allowed.response.status,200);
    assertNoStore(allowed.response);
    const flight=await get(guide,{headers:{RSC:"1"}});
    assert.match(flight.response.headers.get("content-type")??"",/text\/x-component/);
    assert.ok(flight.body.includes("如何定位 JSON 语法错误"));
    assertNoStore(flight.response);
    for (const country of ["CN","US","unknown","HK","CN"] as const) {
      setRegion(country);
      const result=await get(guide,{headers:{RSC:"1"}});
      assertNoStore(result.response);
      assert.match(result.response.headers.get("content-type")??"",/text\/x-component/);
      if (country==="HK") {
        assert.equal(result.response.status,200);
        assert.ok(result.body.includes("如何定位 JSON 语法错误"));
      } else {
        // The router may return a successful Flight transport carrying the not-found state.
        assert.ok([200,404].includes(result.response.status));
        absent(result.body,"如何定位 JSON 语法错误","检查引号、逗号");
      }
    }
    const prefetch=await get(guide,{headers:{RSC:"1","Next-Router-Prefetch":"1"}});
    assertNoStore(prefetch.response);
    absent(prefetch.body,"如何定位 JSON 语法错误","检查引号、逗号");
  });

  await t.test("administrator changes are authenticated, audited and immediately affect the existing carousel",async ()=>{
    setRegion("CN");
    const body=new URLSearchParams({action:"region-visibility",kind:"ad",key:roogoo.id,mode:"overseas"});
    const route="/api/admin/manage";
    assert.equal((await fetchPage("/admin/visibility",{redirect:"manual"})).status,307);
    assert.equal((await fetchPage(route,{method:"POST",headers:{Origin:origin},body})).status,401);
    const login=await fetchPage("/api/admin/session",{method:"POST",headers:{Origin:origin},redirect:"manual",
      body:new URLSearchParams({username:fixture.username,password:fixture.password,action:"login"})});
    assert.equal(login.status,303);
    const cookie=login.headers.getSetCookie()[0]?.split(";",1)[0];
    assert.ok(cookie);
    const admin=await get(`/admin/visibility?kind=ad&key=${roogoo.id}`,{headers:{Cookie:cookie}});
    assert.match(admin.body,/保存地区可见性/);
    assert.match(admin.body,/指定国家或地区可见/);
    assert.equal((await fetchPage(route,{method:"POST",headers:{Cookie:cookie,Origin:"https://invalid.example"},body})).status,403);
    const saved=await fetchPage(route,{method:"POST",headers:{Cookie:cookie,Origin:origin},body,redirect:"manual"});
    assert.equal(saved.status,303);
    const after=await get("/");
    absent(after.body,"home-ad-carousel",roogoo.href,gate.href,content.promotion);
    assertNoStore(after.response);
    setRegion("HK");
    const home=await get("/");
    assert.ok(home.body.includes("home-ad-carousel")&&home.body.includes(roogoo.href));
    using db=new DatabaseSync(fixture.dbFile,{readOnly:true});
    assert.equal(db.prepare("SELECT mode FROM content_region_rules WHERE kind='ad' AND content_key=?").get(roogoo.id)?.mode,"overseas");
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE entity='content_region_rules' AND entity_id=? AND actor=?").get("ad:"+roogoo.id,fixture.username));
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  });
});
