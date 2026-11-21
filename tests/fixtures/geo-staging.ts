import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream";
import { setTimeout as pause } from "node:timers/promises";
import maxmind, { type CountryResponse } from "maxmind";
import { homeAds } from "../../lib/catalog/home-ads";
import { openDirectory, one } from "../../lib/directory/db";
import { saveMerchantAvatar } from "../../lib/directory/merchant-avatar";
import { productHref } from "../../lib/directory/products";
import { publicPrices } from "../../lib/directory/read";
import { recordPageVisitor } from "../../lib/directory/traffic";
import { saveVisibility } from "../../lib/geo/admin";
import { makeAudience } from "../../lib/geo/policy";
import { loadVisibility } from "../../lib/geo/visibility";

export const testAddresses={
  CN:"114.114.114.114",HK:"203.198.23.1",TW:"168.95.1.1",SG:"165.21.83.88",
  US:"8.8.8.8",DE:"194.25.2.129",AU:"139.130.4.5",unknown:"127.0.0.1",
} as const;
export type TestRegion=keyof typeof testAddresses;
export const hiddenSite="geo-vps-fixture";
export const hiddenSiteName="GeoCheckPrivateCloud";
export const networkSite="geo-network-fixture";
export const networkName="GeoCheckNetworkService";
export const vpnOffer="GeoCheckVpnPlan";
export const airportOffer="GeoCheckAirportPlan";
export const proxySite="geo-proxy-fixture";
export const proxyName="GeoCheckProxyMerchant";
export const residentialSite="geo-residential-fixture";
export const residentialName="GeoCheckResidentialMerchant";
export const editorialSlug="geo-observation-fixture";
export const editorialMarker="GeoCheckPrivateObservation";
export const offerMarker="GeoCheckPrivatePlan";

async function listen(server:Server) {
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  return (server.address() as AddressInfo).port;
}

function installTestContent(file:string) {
  using db=openDirectory(file);
  const region=(kind:string,key:string,mode:string,countries="")=>saveVisibility(db,{kind,key,mode,countries},"geo-test");
  const date="2026-10-01";
  const insertSite=db.prepare("INSERT INTO sites(slug,name,website,category_slug,summary,publication,added_at,updated_at) VALUES (?,?,?,?,?,'published',?,?)");
  const insertDomain=db.prepare("INSERT INTO site_domains(domain,site_id,kind,registrable) VALUES (?,?,'primary',?)");
  region("category","airport","countries","HK");
  region("category","vpn","overseas");
  region("category","proxy-services","countries","HK");
  region("category","residential","overseas");
  db.prepare("UPDATE categories SET description=? WHERE slug='proxy-services'").run("GeoCheckProxyCategoryNotes");
  // Network visibility is explicitly enabled on the fixture only.
  const initial=db.prepare("INSERT INTO sites(slug,name,website,category_slug,summary,publication,added_at,updated_at) VALUES (?,?,?,?,?,'archived',?,?)");
  const publish=db.prepare("UPDATE sites SET publication='published' WHERE id=?");
  function addNetworkSite(slug:string,name:string,category:string,domain:string) {
    const id=Number(initial.run(slug,name,`https://${domain}/`,category,name,date,date).lastInsertRowid);
    insertDomain.run(domain,id,"example.org");
    region("site",slug,"overseas");
    publish.run(id);
    return id;
  }
  const vpnDomain="geo-network.example.org";
  const airportDomain="geo-airport.example.org";
  const vpnId=addNetworkSite(networkSite,networkName,"vpn",vpnDomain);
  const airportId=addNetworkSite("geo-airport-fixture","GeoCheckAirportMerchant","airport",airportDomain);
  addNetworkSite(proxySite,proxyName,"proxy-services","geo-proxy.example.org");
  const residentialDomain="geo-residential.example.org";
  const residentialId=addNetworkSite(residentialSite,residentialName,"residential",residentialDomain);
  const insertSource=db.prepare("INSERT INTO sources(site_id,title,url,accessed_at,kind,verified) VALUES (?,?,?,?,'official',1)");
  const insertPrice=db.prepare("INSERT INTO price_records(site_id,source_id,plan,amount_minor,currency,period,region,recorded_at,publication) VALUES (?,?,?,?,'CNY','月','香港',?,'published')");
  const vpnSource=Number(insertSource.run(vpnId,"Fixture quotation",`https://${vpnDomain}/pricing`,date).lastInsertRowid);
  const airportSource=Number(insertSource.run(airportId,"Fixture quotation",`https://${airportDomain}/pricing`,date).lastInsertRowid);
  insertPrice.run(vpnId,vpnSource,vpnOffer,3200,date);
  insertPrice.run(airportId,airportSource,airportOffer+" Basic",3900,date);
  insertPrice.run(airportId,airportSource,airportOffer+" Plus",5800,date);
  const residentialSource=Number(insertSource.run(residentialId,"Fixture quotation",`https://${residentialDomain}/pricing`,date).lastInsertRowid);
  insertPrice.run(residentialId,residentialSource,"公示套餐",2600,date);
  const residentialProduct=productHref(publicPrices(residentialId,db)[0]);
  const siteId=Number(insertSite.run(hiddenSite,hiddenSiteName,"https://geo-cloud.example.net/","vps",hiddenSiteName,date,new Date().toISOString()).lastInsertRowid);
  insertDomain.run("geo-cloud.example.net",siteId,"example.net");
  region("site",hiddenSite,"countries","HK");
  const source=Number(insertSource.run(siteId,"Fixture quotation","https://geo-cloud.example.net/pricing",date).lastInsertRowid);
  insertPrice.run(siteId,source,offerMarker,77733,date);
  const price=publicPrices(siteId,db).find(item=>item.plan===offerMarker)!;
  const product=productHref(price);
  const stamped=new Date().toISOString();
  saveMerchantAvatar(db,{id:siteId,website:"https://geo-cloud.example.net/"},{
    sourceUrl:"https://geo-cloud.example.net/favicon.png",contentType:"image/webp",image:Buffer.from("regional test icon"),
  },"fixture",stamped);
  const avatar=one<{digest:string}>(db,"SELECT digest FROM merchant_avatars WHERE site_id=?",siteId)!.digest;
  const thread=Number(db.prepare("INSERT INTO user_reviews(site_id,score,body,submitted_at,moderation) VALUES (?,5,?,?,'accepted')")
    .run(siteId,"GeoCheckReviewMarker",stamped).lastInsertRowid);
  db.prepare("INSERT INTO editorials(slug,title,summary,body,publication,updated_at) VALUES (?,?,?,?,'published',?)")
    .run(editorialSlug,editorialMarker,editorialMarker,editorialMarker,date);
  region("editorial",editorialSlug,"countries","US");
  region("ad","gate","overseas");
  const promotion=homeAds.find(ad=>ad.id==="musepay")!.href;
  region("promotion",promotion,"countries","US");
  const commonSite=one<{id:number}>(db,"SELECT id FROM sites WHERE slug='chatgpt'")!.id;
  db.prepare("INSERT INTO sources(site_id,title,url,accessed_at,kind,verified,excerpt) VALUES (?,?,?,?,'official',1,?)")
    .run(commonSite,"GeoCheckPromotionSource",promotion,date,promotion);
  const hongKong=loadVisibility(db,makeAudience("HK"));
  for (const path of [`/services/${hiddenSite}`,product,`/services/${residentialSite}`,residentialProduct]) {
    assert.ok(recordPageVisitor(db,path,randomUUID(),Date.now(),hongKong));
  }
  return {product,residentialProduct,avatar:`/api/merchant-avatar/${hiddenSite}/${avatar}`,thread:`/community/${thread}`,promotion};
}

export async function startGeoStaging(initial:TestRegion="CN") {
  const countryFile=resolve(process.env.GEO_TEST_MMDB || "data/geoip/country.mmdb");
  const testDb=await maxmind.open<CountryResponse>(countryFile);
  for (const [country,address] of Object.entries(testAddresses)) {
    if (country !== "unknown") assert.equal(testDb.get(address)?.country?.iso_code,country,`fixture address for ${country} in the supplied MMDB`);
  }
  const directory=resolve("output/geo-tests");
  await mkdir(directory,{recursive:true});
  const scratch=await mkdtemp(join(directory,"run-"));
  const dbFile=join(scratch,"site.sqlite");
  const content=installTestContent(dbFile);
  const reservation=createServer();
  const serverPort=await listen(reservation);
  await new Promise<void>(done=>reservation.close(()=>done()));
  let peer=testAddresses[initial];
  const proxy=createServer((incoming,response)=>{
    const supplied=incoming.headers["x-forwarded-for"];
    const forwarded={...incoming.headers,"x-forwarded-for":supplied?`${supplied}, ${peer}`:peer,"x-forwarded-proto":"https"};
    const upstream=request({host:"127.0.0.1",port:serverPort,path:incoming.url,method:incoming.method,headers:forwarded},result=>{
      if (response.destroyed) {
        result.destroy();
        return;
      }
      response.writeHead(result.statusCode??502,result.headers);
      pipeline(result,response,()=>{});
    });
    upstream.on("error",()=>{
      if (response.destroyed) return;
      if (response.headersSent) response.destroy();
      else response.writeHead(502).end();
    });
    response.on("close",()=>upstream.destroy());
    incoming.pipe(upstream);
  });
  const proxyPort=await listen(proxy);
  const origin=`http://127.0.0.1:${proxyPort}`;
  const username="geo-test-editor";
  const password=randomBytes(24).toString("hex");
  const app=spawn(process.execPath,[resolve(".next/standalone/server.js")],{
    windowsHide:true,
    env:{...process.env,NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",PORT:String(serverPort),HOSTNAME:"127.0.0.1",
      DB_PATH:dbFile,SITE_URL:"https://shanhainexus.com",GEO_IP_MODE:"nginx-direct",GEO_IP_DB:countryFile,
      ADMIN_USERNAME:username,ADMIN_PASSWORD:password,ADMIN_SESSION_SECRET:randomBytes(32).toString("hex"),ADMIN_ORIGIN:origin,
      FILEBOX_ACCOUNT_ORIGIN:"http://127.0.0.1:9",MEMBER_SESSION_KEY:randomBytes(32).toString("hex"),DSH_MODERATION_ENABLED:"0"},
    stdio:["ignore","pipe","pipe"],
  });
  let appOutput="";
  for (const stream of [app.stdout,app.stderr]) stream.on("data",chunk=>{
    appOutput=(appOutput+String(chunk)).slice(-8000);
  });
  async function close() {
    if (app.exitCode===null) app.kill();
    await new Promise<void>(done=>{proxy.close(()=>done()); proxy.closeAllConnections();});
  }
  try {
    let health="no response";
    for (let attempt=0;attempt<100;attempt++) {
      if (app.exitCode!==null) throw new Error("Staging app exited.\n"+appOutput);
      const ready=await fetch(origin+"/api/health",{signal:AbortSignal.timeout(500)}).catch((error:Error)=>{
        health=error.message;
        return undefined;
      });
      if (ready?.ok) return {origin,dbFile,content,username,password,close,setRegion(region:TestRegion) {peer=testAddresses[region];}};
      if (ready) health=String(ready.status);
      await pause(100);
    }
    const direct=await fetch(`http://127.0.0.1:${serverPort}/api/health`,{signal:AbortSignal.timeout(1000)}).catch(()=>undefined);
    throw new Error(`Staging health via proxy ${health}, direct ${direct?.status??"unreachable"}.\n`+appOutput);
  } catch (error) { await close(); throw error; }
}
