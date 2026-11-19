import type { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { one,transaction } from "./db";
import { candidate,extractMetadata } from "./imports";
import { NetworkFailure,parseProxy,requestPublicNetwork,retryableNetworkCodes,type ProxyRoute } from "./network-transport";
import type { ImportItem } from "./types";
import { now,websiteUrl } from "./validation";

const agentName="ShanhaiNexus";
const userAgent=`${agentName}/1.0 (+https://shanhainexus.com/policy)`;
type Result = { state:ImportItem["reachability"]; status?:number; finalUrl?:string; reason:string; title?:string; description?:string };
type Page = { status:number; location?:string; body:string; contentType:string; truncated:boolean };
export type Visit = (url:URL,signal:AbortSignal,maxBytes:number)=>Promise<Page>;

export function robotsPermits(text:string,path:string) {
  const groups:{agents:string[];rules:{allow:boolean;pattern:string}[]}[]=[];
  let group:typeof groups[number]|undefined;
  let started=false;
  for (const raw of text.split(/\r?\n/)) {
    const match=/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i.exec(raw.replace(/#.*/,""));
    if (!match) continue;
    const [,field,value]=match;
    if (field.toLowerCase()==="user-agent") {
      if (!group || started) { group={agents:[],rules:[]};groups.push(group);started=false; }
      group.agents.push(value.toLowerCase());
    } else if (group && /^(allow|disallow)$/i.test(field)) {
      started=true;
      if (value && value.startsWith("/") && value.length<2048) group.rules.push({allow:field.toLowerCase()==="allow",pattern:value});
    }
  }
  const own=groups.filter(g=>g.agents.includes(agentName.toLowerCase()));
  const relevant=own.length?own:groups.filter(g=>g.agents.includes("*"));
  let best=-1,permitted=true;
  for (const {pattern,allow} of relevant.flatMap(g=>g.rules)) {
    const terminal=pattern.endsWith("$");
    const body=terminal?pattern.slice(0,-1):pattern;
    const parts=body.split(/\*+/);
    if (!path.startsWith(parts[0])) continue;
    let offset=parts[0].length;
    let matches=true;
    for (const part of parts.slice(1,terminal?-1:undefined)) {
      const position=path.indexOf(part,offset);
      if (position<0) { matches=false;break; }
      offset=position+part.length;
    }
    if (terminal) {
      const end=parts.at(-1)??"";
      matches&&=parts.length===1?path===end:path.endsWith(end)&&path.length-end.length>=offset;
    }
    const weight=body.replace(/\*/g,"").length;
    if (matches && (weight>best || (weight===best && allow))) { best=weight;permitted=allow; }
  }
  return permitted;
}

export const websiteVisit=(proxy?:ProxyRoute,options:{compressed?:boolean}={}):Visit=>(url,signal,maxBytes)=>requestPublicNetwork(url,{signal,maxBytes,proxy,compressed:options.compressed,
  headers:{"user-agent":userAgent,accept:"text/html,text/plain,application/xhtml+xml,application/json,application/xml,text/xml,text/csv"}});
const visit:Visit=(url,signal,maxBytes)=>websiteVisit(parseProxy(process.env.MERCHANT_PROXY))(url,signal,maxBytes);

export class WebsiteNetworkFailure extends Error {
  constructor(readonly step:"robots"|"page",readonly failure:NetworkFailure) {
    super(`${step==="robots"?"robots.txt":"公开页面"} ${failure.message} (${failure.stage})`,{cause:failure});
  }
}

async function requestStep(request:Visit,url:URL,signal:AbortSignal,maxBytes:number,step:"robots"|"page",retries:number) {
  for (let attempt=0;;attempt++) {
    try { return await request(url,signal,maxBytes); }
    catch (error) {
      if (!(error instanceof NetworkFailure)) throw error;
      if (attempt>=retries||signal.aborted||!retryableNetworkCodes.has(error.code)) throw new WebsiteNetworkFailure(step,error);
      try { await delay(300,undefined,{signal}); }
      catch { throw new WebsiteNetworkFailure(step,new NetworkFailure("total_timeout",error.stage)); }
    }
  }
}

const redirected = (status:number) => [301,302,303,307,308].includes(status);

export async function readPublicPage(input:string,request:Visit=visit,maxBytes=96_000,deadline=18_000,retries=1,approvedExport=false) {
  const original=websiteUrl(input);
  let url=new URL(original.url);
  if (!approvedExport || url.search!=="?format=json") url.search="";
  const signal=AbortSignal.timeout(deadline);
  const rules=new Map<string,string>();
  for (let step=0;step<4;step++) {
    let rule=rules.get(url.origin);
    if (rule===undefined) {
      let reference=new URL("/robots.txt",url.origin);
      let robots=await requestStep(request,reference,signal,512_000,"robots",retries);
      for (let hop=0;hop<2 && redirected(robots.status) && robots.location;hop++) {
        const target=websiteUrl(new URL(robots.location,reference).href);
        if (target.registrable!==original.registrable) throw new Error(`robots.txt 跳往其他注册域（${target.registrable}），需人工确认`);
        reference=new URL(target.url);
        robots=await requestStep(request,reference,signal,512_000,"robots",retries);
      }
      const missing=[404,410].includes(robots.status);
      if (!missing && (robots.status<200 || robots.status>=300 || robots.truncated || /<html|<!doctype/i.test(robots.body))) {
        throw new Error(`无法确认 robots.txt（HTTP ${robots.status}）`);
      }
      rule=missing?"":robots.body;
      rules.set(url.origin,rule);
    }
    if (!robotsPermits(rule,url.pathname+url.search)) throw new Error("robots.txt 禁止此路径");
    const page=await requestStep(request,url,signal,maxBytes,"page",retries);
    if (redirected(page.status)&&page.location) {
      const next=websiteUrl(new URL(page.location,url).href);
      if (next.registrable!==original.registrable) throw new Error(`跳往其他注册域（${next.registrable}），需人工确认`);
      url=new URL(next.url);
      url.search="";
      continue;
    }
    if (page.status<200||page.status>=300) throw new Error(`公开页面返回 HTTP ${page.status}`);
    if (/<title>\s*(?:just a moment|attention required|access denied|captcha)/i.test(page.body)) throw new Error("公开页面要求访问验证");
    return {...page,url:url.href};
  }
  throw new Error("同域跳转次数达到上限");
}

export async function checkWebsite(input:string,request:Visit=visit,timeout=18_000):Promise<Result> {
  const original=websiteUrl(input);
  let url=new URL(original.url);
  url.search="";
  const signal=AbortSignal.timeout(timeout);
  const robotsCache=new Map<string,Page>();
  let checkingRobots=true;
  try {
    for (let hop=0;hop<4;hop++) {
      checkingRobots=true;
      let robots=robotsCache.get(url.origin);
      if (!robots) {
        robots=await requestStep(request,new URL("/robots.txt",url.origin),signal,512_000,"robots",1);
        robotsCache.set(url.origin,robots);
      }
      if (redirected(robots.status)) {
        return {state:"skipped",status:robots.status,reason:"robots.txt 重定向，需人工查看。"};
      }
      const hasRules=robots.status>=200 && robots.status<300;
      if (hasRules && (robots.truncated || (/html/i.test(robots.contentType) && /<html|<!doctype/i.test(robots.body)))) {
        return {state:"skipped",status:robots.status,reason:"robots.txt 返回网页或超出读取上限。"};
      }
      if (!hasRules && ![404,410].includes(robots.status)) {
        return {state:"skipped",status:robots.status,reason:`robots.txt HTTP ${robots.status}，本次暂停。`};
      }
      if (hasRules && !robotsPermits(robots.body,url.pathname+url.search)) return {state:"skipped",reason:"robots.txt 不允许该路径。"};
      checkingRobots=false;
      const page=await requestStep(request,url,signal,96_000,"page",1);
      const finalUrl=url.href;
      if (redirected(page.status) && page.location) {
        const next=websiteUrl(new URL(page.location,url).href);
        if (next.registrable!==original.registrable) return {state:"inconclusive",status:page.status,finalUrl:next.url,reason:"跳往其他注册域，需人工确认主体。"};
        url=new URL(next.url);
        url.search="";
        continue;
      }
      if ([401,403,429,451,503].includes(page.status) ||
          /<title>\s*(?:just a moment|attention required|access denied|captcha)/i.test(page.body)) {
        return {state:"restricted",status:page.status,finalUrl,reason:`官网返回访问限制或验证页（HTTP ${page.status}）。`};
      }
      if (page.status>=200 && page.status<300 && /(?:html|xhtml)/i.test(page.contentType)) {
        return {state:"reachable",status:page.status,finalUrl,reason:`公开页面返回 HTTP ${page.status}。`,...extractMetadata(page.body)};
      }
      return {state:"inconclusive",status:page.status,finalUrl,reason:`官网返回 HTTP ${page.status}，需人工复核。`};
    }
    return {state:"inconclusive",reason:"同域跳转次数达到上限。"};
  } catch (error) {
    if (error instanceof WebsiteNetworkFailure) return {state:error.step==="robots"?"skipped":"unreachable",reason:error.message};
    const cause=error as NodeJS.ErrnoException;
    const detail=signal.aborted?"超时":String(cause.code??cause.message??"请求失败").slice(0,180);
    return {state:checkingRobots?"skipped":"unreachable",reason:`${checkingRobots?"robots.txt":"官网"}请求未完成：${detail}`};
  }
}

export function saveCheck(db:DatabaseSync,row:Pick<ImportItem,"id"|"payload">,result:Result) {
  return transaction(db,()=>{
    const latest=one<Pick<ImportItem,"payload"|"site_id"|"domain">>(db,"SELECT payload,site_id,domain FROM import_items WHERE id=?",row.id);
    const {data}=candidate(JSON.parse(row.payload));
    if (!latest || candidate(JSON.parse(latest.payload)).data.url!==data.url) return false;
    const checked=now();
    db.prepare("INSERT INTO website_checks(item_id,checked_at,result,http_status,final_url,reason) VALUES (?,?,?,?,?,?)")
      .run(row.id,checked,result.state,result.status??null,result.finalUrl??null,result.reason);
    if (result.title || result.description) {
      db.prepare(`UPDATE import_items SET payload=json_set(payload,'$.website_title',?,'$.website_description',?) WHERE id=?`)
        .run(result.title??"",result.description??"",row.id);
    }
    db.prepare("UPDATE import_items SET reachability=?,checked_at=?,check_detail=?,final_url=? WHERE id=?")
      .run(result.state,checked,result.reason,result.finalUrl??null,row.id);
    db.prepare("UPDATE sites SET reachability=?,checked_at=? WHERE website=? AND id IN (SELECT site_id FROM site_domains WHERE domain=? AND kind='primary')")
      .run(result.state,checked,data.url,latest.domain);
    return true;
  });
}
