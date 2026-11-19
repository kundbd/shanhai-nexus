import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { homeAds } from "../../lib/catalog/home-ads";
import { siteConsentAction, siteConsentVersion } from "../../lib/site-consent";
import {
  editorialMarker, editorialSlug, hiddenArticle, hiddenGuide, hiddenSite, hiddenSiteName,
  airportOffer, networkName, networkSite, offerMarker, proxyName, proxySite, residentialName, residentialSite, startGeoStaging, vpnOffer,
} from "../fixtures/geo-staging";

const guide=`/guides/${hiddenGuide}`;
const article=`/guides/${hiddenArticle}`;
const shop=`/services/${hiddenSite}`;
const network=`/services/${networkSite}`;
const editorial=`/observations/${editorialSlug}`;
const gate=homeAds.find(item=>item.id==="gate")!;
const roogoo=homeAds.find(item=>item.id==="roogoo")!;
const networkAds=homeAds.filter(ad=>ad.network);

test("production standalone region policies through a trusted local proxy", {timeout:120_000}, async t=>{
  const fixture=await startGeoStaging();
  t.after(fixture.close);
  const {origin,content,setRegion}=fixture;
  const asGuest=(path:string,init?:RequestInit)=>fetch(origin+path,{signal:AbortSignal.timeout(9_000),...init});
  const confirm=(body:URLSearchParams,originHeader=origin)=>asGuest(siteConsentAction,{
    method:"POST",body,headers:{Origin:originHeader,"Sec-Fetch-Site":originHeader===origin?"same-origin":"cross-site"},redirect:"manual",
  });
  const accepted = await confirm(new URLSearchParams({agreement:siteConsentVersion,privacy:siteConsentVersion}));
  assert.equal(accepted.status,303);
  const cookie=accepted.headers.getSetCookie()[0]??"";
  assert.match(cookie,/;\s*secure\b/i);
  const consent=cookie.split(";",1)[0];
  assert.ok(consent);
  const fetchPage=(path:string,init?:RequestInit)=>{
    const headers=new Headers(init?.headers);
    headers.set("Cookie",[consent,headers.get("Cookie")].filter(Boolean).join("; "));
    return asGuest(path,{...init,headers});
  };
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
  const regionLabel=(body:string,label:string,flag?:string)=>{
    const header=/<header class="site-header"[\s\S]*?<\/header>/.exec(body)?.[0]??"";
    const footer=/<footer[\s\S]*?<\/footer>/.exec(body)?.[0]??"";
    assert.ok(header.replace(/<!--[\s\S]*?-->/g,"").includes("当前内容地区："+label),`Expected the header region ${label}`);
    assert.equal(/data-flag="([^"]+)"/.exec(header)?.[1],flag);
    assert.ok(header.includes("地区数据由 DB-IP 提供"));
    absent(footer,"当前内容地区","地区数据由 DB-IP 提供");
  };

  await t.test("guest documents and Flight payloads request both agreements before showing content",async ()=>{
    setRegion("HK");
    for (const headers of [undefined,{RSC:"1"}]) {
      const response=await asGuest(shop,{headers});
      assert.equal(response.status,200);
      assertNoStore(response);
      const html=await response.text();
      assert.ok(html.includes("不支持地区的用户禁止通过不法手段访问本站。"));
      if (!headers) assert.ok(html.includes("本人接受本站隐私政策"));
      absent(html,hiddenSiteName,offerMarker,"site-header");
    }
    const partial=await confirm(new URLSearchParams({agreement:siteConsentVersion}));
    assert.equal(partial.status,400);
    assert.equal(partial.headers.getSetCookie().length,0);
    const crossSite=await confirm(new URLSearchParams({agreement:siteConsentVersion,privacy:siteConsentVersion}),"https://example.org");
    assert.equal(crossSite.status,403);
    assert.equal(crossSite.headers.getSetCookie().length,0);
    const resumed=await get(shop);
    assert.equal(resumed.response.status,200);
    assert.ok(resumed.body.includes(hiddenSiteName));
  });

  await t.test("CN home, categories, guides and navigation",async ()=>{
    setRegion("CN");
    const home=await get("/");
    assert.equal(home.response.status,200);
    regionLabel(home.body,"中国大陆","cn");
    absent(home.body,hiddenSiteName,networkName,"/categories/vpn",gate.href,content.promotion);
    assert.ok(home.body.includes(roogoo.href));
    assert.ok((await get("/guides")).body.includes(article));
    absent((await get("/guides")).body,`href="${guide}"`);
    absent((await get("/services?group=all")).body,hiddenSiteName,networkName,"/categories/vpn");
  });

  await t.test("HK content and restricted category",async ()=>{
    setRegion("HK");
    const home=await get("/");
    regionLabel(home.body,"中国香港","hk");
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

  await t.test("US per-country inclusion and the overseas preset",async ()=>{
    setRegion("US");
    const home=await get("/");
    regionLabel(home.body,"美国","us");
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

  await t.test("network home ads, quote subcategories and merchant counts follow regional rules",async ()=>{
    const cardCount=(html:string,slug:string,count:number)=>{
      const card=new RegExp(`<a[^>]*href="/categories/${slug}"[^>]*>([\\s\\S]*?)</a>`).exec(html)?.[1]??"";
      assert.ok(card.replaceAll("<!-- -->","").includes(`公开档案 ${count} 家`),slug);
    };
    assert.deepEqual(networkAds.map(ad=>ad.id),["flowercloud","liangxin-yun"]);
    setRegion("HK");
    const airport=await get("/?price=airport");
    assertNoStore(airport.response);
    assert.ok(airport.body.includes("机场与 VPN")&&airport.body.includes('href="/?price=vpn#home-prices"'));
    assert.ok(airport.body.includes(airportOffer+" Basic")&&airport.body.includes(airportOffer+" Plus"));
    assert.ok(airport.body.includes("价格最低")&&airport.body.includes("价格最高"));
    absent(airport.body,vpnOffer);
    assert.equal((await get("/?price=vpn",{headers:{RSC:"1"}})).body.includes(vpnOffer),true);
    for (const slug of ["vpn","airport"]) cardCount(airport.body,slug,1);
    cardCount(airport.body,"proxy-services",2);
    for (const ad of networkAds) assert.ok(airport.body.includes(`href="${ad.href}"`)&&airport.body.includes(ad.logo!));

    setRegion("US");
    const vpn=await get("/?price=vpn");
    assert.ok(vpn.body.includes("机场与 VPN")&&vpn.body.includes(vpnOffer));
    absent(vpn.body,'href="/?price=airport#home-prices"',airportOffer);
    cardCount(vpn.body,"proxy-services",1);
    for (const ad of networkAds) assert.ok(vpn.body.includes(`href="${ad.href}"`));

    for (const country of ["CN","unknown"] as const) {
      setRegion(country);
      for (const path of ["/?price=airport","/?price=vpn"]) {
        for (const headers of [undefined,{RSC:"1"}]) {
          const denied=await get(path,{headers});
          assertNoStore(denied.response);
          absent(denied.body,"机场与 VPN",airportOffer,vpnOffer,"/categories/airport","/categories/vpn","/categories/proxy-services",
            ...networkAds.flatMap(ad=>[ad.title,ad.href,ad.logo!]));
        }
      }
    }
  });

  await t.test("Taiwan, Southeast Asia, Europe and generic regions share the overseas scope",async ()=>{
    const cases = [
      ["TW","中国台湾","cn"],["SG","新加坡","sg"],["DE","德国","de"],["AU","其他区域",undefined],
    ] as const;
    for (const [country,label,flag] of cases) {
      setRegion(country);
      const home=await get("/");
      regionLabel(home.body,label,flag);
      assert.ok(home.body.includes(gate.href.replaceAll("&","&amp;")));
      assert.ok(home.body.includes("/categories/vpn"));
      assert.equal((await get(network)).response.status,200);
      assert.equal((await get(editorial)).response.status,404);
    }
    const sprites=await fetchPage("/region/flags.webp");
    assert.equal(sprites.status,200);
    assert.match(sprites.headers.get("content-type")??"",/image\/webp/);
    assert.equal(Buffer.from(await sprites.arrayBuffer()).subarray(8,12).toString(),"WEBP");
  });

  await t.test("unknown IP falls back to CN and public headers do not choose a region",async ()=>{
    const claimed={"CF-IPCountry":"HK","CF-Connecting-IP":"203.198.23.1",
      "X-Real-IP":"203.198.23.1","X-Forwarded-For":"203.198.23.1, 8.8.8.8","Forwarded":"for=203.198.23.1"};
    for (const country of ["CN","unknown"] as const) {
      setRegion(country);
      const home=await get("/",{headers:claimed});
      regionLabel(home.body,"中国大陆","cn");
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

  await t.test("proxy and residential entries share a public category with their existing region rules",async ()=>{
    const category="/categories/proxy-services";
    const legacy="/categories/residential";
    const proxy=`/services/${proxySite}`;
    const residential=`/services/${residentialSite}`;
    const query=(value:string)=>`/search?${new URLSearchParams({q:value,type:"service"})}`;
    setRegion("HK");
    const home=(await get("/")).body;
    const cards=/<nav id="home-categories"[\s\S]*?<\/nav>/.exec(home)?.[0]??"";
    assert.equal(cards.split(`href="${category}"`).length-1,1);
    const proxyCard=/<a[^>]*href="\/categories\/proxy-services"[^>]*>[\s\S]*?<\/a>/.exec(cards)?.[0]??"";
    const relayCard=/<a[^>]*href="\/categories\/ai-relay"[^>]*>[\s\S]*?<\/a>/.exec(cards)?.[0]??"";
    assert.match(proxyCard,/\blucide-globe\b/);
    assert.match(relayCard,/\blucide-network\b/);
    absent(cards,`href="${legacy}"`);
    const combined=await get(category+"?sort=name");
    assert.equal(combined.response.status,200);
    assert.match(combined.body,/<h1>代理 IP 服务<\/h1>/);
    assert.match(combined.body,/\blucide-globe\b/);
    assert.ok(combined.body.replaceAll("<!-- -->","").includes("公开 2 家"));
    assert.ok(combined.body.includes("GeoCheckProxyCategoryNotes"));
    for (const href of [proxy,residential]) assert.ok(combined.body.includes(`href="${href}"`),href);
    const original=await get(legacy+"?sort=name&tag=a&tag=b",{redirect:"manual"});
    assert.equal(original.response.status,307);
    const destination=new URL(original.response.headers.get("location")!,origin);
    assert.equal(destination.pathname,category);
    assert.equal(destination.searchParams.get("sort"),"name");
    assert.deepEqual(destination.searchParams.getAll("tag"),["a","b"]);
    assertNoStore(original.response);
    const filtered=await get("/services?category=residential");
    assert.equal(filtered.response.status,200);
    assert.ok(filtered.body.includes(proxyName)&&filtered.body.includes(residentialName));
    const selectedOption=/<option\b[^>]*\bvalue="proxy-services"[^>]*>/.exec(filtered.body)?.[0]??"";
    assert.match(selectedOption,/\bselected=""/);
    absent(filtered.body,'<option value="residential"');
    assert.ok((await get(query("住宅代理"))).body.includes(`href="${residential}"`));
    assert.ok((await get(query("代理 IP 服务 月付"))).body.includes(`href="${residential}"`));
    assert.ok((await get(residential)).body.includes(`href="${category}">代理 IP 服务</a>`));
    const product=await get(content.residentialProduct);
    assert.equal(product.response.status,200);
    assert.ok(product.body.includes("代理 IP 服务"));
    assert.ok((await get("/rankings?group=connections&period=overall")).body.includes(residentialName));
    assert.ok((await get("/rankings?group=connections&type=products&period=overall")).body.includes(content.residentialProduct));
    absent((await get("/rankings?group=vps&period=overall")).body,residentialName);

    setRegion("US");
    const shared=await get(category);
    assert.equal(shared.response.status,200);
    assert.ok(shared.body.includes(residentialName));
    absent(shared.body,proxyName,"GeoCheckProxyCategoryNotes");
    assert.equal((await get(proxy)).response.status,404);
    assert.equal((await get(content.residentialProduct)).response.status,200);
    assert.ok((await get("/rankings?group=connections&period=overall")).body.includes(residentialName));

    setRegion("CN");
    for (const path of [category,legacy,proxy,residential,content.residentialProduct,"/services?category=residential"]) {
      const result=await get(path,{redirect:"manual"});
      assert.equal(result.response.status,404,path);
      absent(result.body,proxyName,residentialName);
    }
    absent((await get(query("住宅代理"))).body,residentialName);
  });

  await t.test("one conservative sitemap for every country",async ()=>{
    const sitemaps=[];
    for (const country of ["CN","HK","TW","US","AU","unknown"] as const) {
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
    assert.match(admin.body,/仅中国大陆以外地区可见/);
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
