import { boundedText,extractMetadata } from "./imports";
import { deepSeekSearchReference,searchDeepSeek } from "./deepseek-search";
import { searchQueries } from "./discovery-rules";
import type { Pipeline } from "./taxonomy";
import { readPublicPage } from "./website-check";
import { websiteUrl } from "./validation";

export type Lead = {url:string; evidence?:string; query?:string; name?:string; category?:string};
export type SourceKind = "brave"|"deepseek"|"page"|"sitemap"|"dataset"|"manual";
export type DiscoveryConfig = {url:string; pipeline:Pipeline; kind:SourceKind; access:"licensed"|"official"|"leads"|"restricted"; queryCursor?:number};
export type ProviderOptions = {pageLimit?:number;queryLimit?:number;fetcher?:typeof fetch;read?:typeof readPublicPage;manual?:Lead[];reserveDeepSeek?:()=>void};
export type Found = {leads:Lead[];errors:string[];nextCursor?:number};

const decoding=(s:string)=>s.replace(/&amp;/g,"&").replace(/&#(?:x2f|47);/gi,"/");
function links(body:string,start:string) {
  const out=new Set<string>();
  for (const match of body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'<>]{1,1200})["']/gi)) {
    try {
      const url=new URL(decoding(match[1]),start);
      if (url.origin!==new URL(start).origin) out.add(url.href);
    } catch { /* Ignore malformed references. */ }
    if (out.size>=150) break;
  }
  return [...out];
}
function sitemapLinks(body:string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new Error("站点地图包含不支持的 XML 声明");
  return [...body.matchAll(/<loc>\s*([^<]{1,1500})\s*<\/loc>/gi)].map(match=>decoding(match[1].trim())).slice(0,150);
}
function cleanResponse(data:unknown) {
  const value=data as {web?:{results?:unknown[]};query?:{more_results_available?:boolean}};
  const leads=(value?.web?.results??[]).filter((row):row is {url:string}=>!!row && typeof row==="object" &&
    typeof (row as {url?:unknown}).url==="string").map(({url})=>url);
  return {leads,more:value?.query?.more_results_available===true};
}
async function brave(source:DiscoveryConfig,options:ProviderOptions):Promise<Found> {
  const token=process.env.DISCOVERY_BRAVE_TOKEN;
  if (!token) throw new Error("未设置 DISCOVERY_BRAVE_TOKEN");
  if (process.env.DISCOVERY_BRAVE_STORAGE_RIGHTS!=="1") throw new Error("搜索 API 存储授权未确认");
  const leads:Lead[]=[];
  const errors:string[]=[];
  const queries=searchQueries(source.pipeline);
  const cursor=(source.queryCursor??0)%queries.length;
  const limit=Math.min(options.queryLimit??4,queries.length,12);
  for (let i=0;i<limit;i++) {
    const {query,lang}=queries[(cursor+i)%queries.length];
    for (let offset=0;offset<Math.min(options.pageLimit??2,10);offset++) {
      try {
        const endpoint=new URL("https://api.search.brave.com/res/v1/web/search");
        endpoint.search=new URLSearchParams({q:query,search_lang:lang,count:"20",offset:String(offset),result_filter:"web"}).toString();
        const response=await (options.fetcher??fetch)(endpoint,{headers:{Accept:"application/json","X-Subscription-Token":token},
          redirect:"error",signal:AbortSignal.timeout(9000),cache:"no-store"});
        if (!response.ok) {
          if ([401,403,429].includes(response.status)) return {leads,errors:[...errors,`搜索 API HTTP ${response.status}`]};
          throw new Error(`搜索 API HTTP ${response.status}`);
        }
        const result=cleanResponse(JSON.parse(await boundedText(response,1_000_000)));
        leads.push(...result.leads.map(url=>({url,query})));
        if (!result.more) break;
      } catch (error) {
        errors.push(`关键词「${query}」第 ${offset+1} 页：${error instanceof Error?error.message:"未完成"}`);
        break;
      }
    }
  }
  return {leads,errors,nextCursor:(cursor+limit)%queries.length};
}
async function deepSeek(source:DiscoveryConfig,options:ProviderOptions):Promise<Found> {
  if (source.access!=="leads" || !options.reserveDeepSeek) throw new Error("DeepSeek Search 需要线索来源和请求预算");
  const queries=searchQueries(source.pipeline);
  const cursor=(source.queryCursor??0)%queries.length;
  const {query,lang}=queries[cursor];
  const localized=`${query} lang:${lang==="zh-hans"?"zh":"en"}`;
  const {urls}=await searchDeepSeek(localized,10,options.fetcher,options.reserveDeepSeek);
  return {leads:urls.map(url=>({url,query:localized,evidence:deepSeekSearchReference})),errors:[],nextCursor:(cursor+1)%queries.length};
}
export async function discoverFrom(source:DiscoveryConfig,options:ProviderOptions={}):Promise<Found> {
  if (source.access==="restricted") throw new Error("来源限制自动访问或复用");
  if (source.kind==="brave") return brave(source,options);
  if (source.kind==="deepseek") return deepSeek(source,options);
  if (source.kind==="manual") {
    if (!options.manual?.length) throw new Error("本地名单任务需要经许可或逐站核验的输入文件");
    return {leads:options.manual,errors:[]};
  }
  const read=options.read??readPublicPage;
  const page=await read(source.url,undefined,source.kind==="dataset"?2_000_000:256_000);
  if (page.truncated) throw new Error("来源超过读取上限，使用授权的分批文件导入");
  if (source.kind==="page") {
    if (!/html/i.test(page.contentType)) throw new Error("来源没有返回公开 HTML");
    return {leads:links(page.body,page.url).map(url=>({url,evidence:page.url})),errors:[]};
  }
  if (source.kind==="sitemap") {
    const registry=websiteUrl(source.url).registrable;
    const accepted=(values:string[])=>values.filter(url=>{
      try { return websiteUrl(url).registrable===registry; } catch { return false; }
    });
    let discovered=accepted(sitemapLinks(page.body));
    const errors:string[]=[];
    if (/<sitemapindex\b/i.test(page.body)) {
      const nested:string[]=[];
      for (const url of discovered.slice(0,3)) {
        try { nested.push(...accepted(sitemapLinks((await read(url,undefined,256_000)).body))); }
        catch { errors.push("部分站点地图子索引不可读取"); }
      }
      discovered=nested;
    }
    return {leads:discovered.slice(0,150).map(url=>({url,evidence:page.url})),errors};
  }
  if (source.access!=="licensed") throw new Error("数据集必须具备明确复用许可");
  const raw=JSON.parse(page.body);
  if (!Array.isArray(raw)) throw new Error("数据集须为 {name,url,category} JSON 数组");
  return {leads:raw.slice(0,1000).flatMap(record=>{
    const url=record?.url??record?.website;
    return typeof url==="string"?[{url,name:typeof record.name==="string"?record.name:undefined,
      category:typeof record.category==="string"?record.category:undefined,evidence:page.url}]:[];
  }),errors:[]};
}

export function parseMerchantMetadata(html:string) {
  const {title,description}=extractMetadata(html);
  const siteName=[...html.matchAll(/<meta\b[^>]{1,1000}>/gi)].find(match=>/\bproperty\s*=\s*["']og:site_name["']/i.test(match[0]))?.[0]
    .match(/\bcontent\s*=\s*["']([^"']{1,120})["']/i)?.[1];
  const language=/<html\b[^>]*\blang\s*=\s*["']([a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3})["']/i.exec(html)?.[1];
  return {title,description,siteName,language};
}

export function externalSalesLink(html:string,reference:string) {
  const own=websiteUrl(reference).registrable;
  for (const [,href,label] of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'<>]{1,1200})["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    if (!/购买|下单|前往官网|立即订阅|注册开通|buy now|visit official|subscribe now|order now/i.test(label.replace(/<[^>]*>/g,""))) continue;
    try {
      const target=websiteUrl(new URL(decoding(href),reference).href);
      if (target.registrable!==own) return target.registrable;
    } catch { /* Skip non-web links. */ }
  }
  return "";
}
