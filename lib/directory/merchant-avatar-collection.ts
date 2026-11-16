import sharp from "sharp";
import type { AvatarImage, AvatarTarget } from "./merchant-avatar";
import { requestPublicNetwork, type ProxyRoute } from "./network-transport";
import { readPublicPage, type Visit } from "./website-check";
import { websiteUrl } from "./validation";

const agent="ShanhaiNexus/1.0 (+https://shanhainexus.com/policy)";
const maximumInput=640_000;
const supportedRaster=new Set(["png","jpeg","webp","gif","svg"]);

function publicUrl(value:string,base:URL) {
  try { return websiteUrl(new URL(value.replace(/&amp;/gi,"&"),base).href).url; }
  catch { return null; }
}

function attributes(tag:string) {
  return Object.fromEntries([...tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
    .map(([,key,quoted,single,bare])=>[key.toLowerCase(),quoted??single??bare]));
}

function organizationLogo(html:string,page:URL,hosted:boolean) {
  const pageIdentity=(url:URL)=>url.hostname.replace(/^www\./,"")+url.pathname.replace(/\/$/,"");
  function search(node:unknown,depth=0):string|null {
    if (depth>5||!node||typeof node!=="object") return null;
    if (Array.isArray(node)) {
      for (const item of node.slice(0,50)) { const match=search(item,depth+1); if(match) return match; }
      return null;
    }
    const entry=node as Record<string,unknown>;
    if (/\b(?:Organization|Store|OnlineStore|LocalBusiness)\b/i.test(String(entry["@type"]))) {
      const identity=typeof entry.url==="string"?publicUrl(entry.url,page):null;
      if (!hosted||(identity&&pageIdentity(new URL(identity))===pageIdentity(page))) {
        const logo=typeof entry.logo==="object"&&entry.logo?entry.logo as Record<string,unknown>:null;
        const image=logo?.contentUrl??logo?.url??entry.logo;
        if (typeof image==="string") return publicUrl(image,page);
      }
    }
    return search(entry["@graph"],depth+1);
  }
  for (const match of html.matchAll(/<script\b([^>]{0,500})>([\s\S]*?)<\/script\s*>/gi)) {
    if (attributes(match[1]).type!=="application/ld+json"||match[2].length>80_000) continue;
    try { const logo=search(JSON.parse(match[2])); if (logo) return logo; } catch { /* Malformed metadata is optional. */ }
  }
  return null;
}

export function declaredAvatarUrls(html:string,page:URL,hosted:boolean) {
  const logo=organizationLogo(html,page,hosted);
  if (hosted) return logo?[logo]:[];
  const icons=[...html.matchAll(/<link\b(?:"[^"]*"|'[^']*'|[^'">]){0,1500}>/gi)].flatMap(([tag])=>{
    const {rel,href,sizes}=attributes(tag);
    if (!href||!rel?.toLowerCase().split(/\s+/).some(value=>value==="icon"||value==="apple-touch-icon")) return [];
    const url=publicUrl(href,page);
    return url?[{url,rank:sizes?.toLowerCase()==="any"?128:Math.min(128,parseInt(sizes??"",10)||32)}]:[];
  }).sort((a,b)=>b.rank-a.rank);
  return [...new Set([...(logo?[logo]:[]),...icons.map(({url})=>url)].slice(0,4).concat(new URL("/favicon.ico",page).href))];
}

async function webp(input:Buffer) {
  const raster=input.readUInt32BE(0)===0x89504e47||input.readUInt16BE(0)===0xffd8||
    /^GIF8[79]a$/.test(input.subarray(0,6).toString("ascii"))||
    (input.toString("ascii",0,4)==="RIFF"&&input.toString("ascii",8,12)==="WEBP");
  if (raster) return rasterWebp(input);
  const text=input.toString("utf8");
  if (!/^[\s\uFEFF]*(?:<\?xml\b[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(text)) return null;
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<\s*(?:script|foreignObject)\b|@import|(?:[\w:-]*href\s*=\s*["']|url\(\s*["']?)\s*[^#\s"')]/i.test(text)) return null;
  return rasterWebp(input);
}

async function rasterWebp(input:Buffer) {
  const pipeline=sharp(input,{limitInputPixels:4_000_000,failOn:"error"});
  const data=await pipeline.metadata();
  if (!data.format||!supportedRaster.has(data.format)||!data.width||!data.height||data.width/data.height>3||data.height/data.width>3) return null;
  return pipeline.resize(96,96,{fit:"inside",withoutEnlargement:true}).webp({quality:84}).toBuffer();
}

async function ico(input:Buffer) {
  if (input.length<22||input.readUInt32LE(0)!==0x00010000) return null;
  const count=input.readUInt16LE(4);
  if (count<1||count>64||6+16*count>input.length) return null;
  const entries=Array.from({length:count},(_,index)=>{
    const entry=input.subarray(6+index*16,22+index*16);
    return {entry,width:entry[0]||256,height:entry[1]||256,length:entry.readUInt32LE(8),offset:entry.readUInt32LE(12)};
  }).filter(({width,height,length,offset})=>width===height&&length>40&&length<=64_000&&offset>=6+16*count&&offset+length<=input.length)
    .sort((a,b)=>Math.abs(a.width-64)-Math.abs(b.width-64));
  for (const {entry,width,height,length,offset} of entries) {
    const frame=input.subarray(offset,offset+length);
    if (frame.readUInt32BE(0)===0x89504e47) {
      const image=await webp(frame).catch(()=>null);
      if (image) return {image,contentType:"image/webp" as const};
    }
    if (frame.readUInt32LE(0)===40&&frame.readInt32LE(4)===width&&frame.readInt32LE(8)===height*2&&frame.readUInt16LE(12)===1&&
        [1,4,8,24,32].includes(frame.readUInt16LE(14))&&frame.readUInt32LE(16)===0) {
      const icon=Buffer.concat([Buffer.from([0,0,1,0,1,0]),entry,frame]);
      icon.writeUInt32LE(22,18);
      return {image:icon,contentType:"image/x-icon" as const};
    }
  }
  return null;
}

export async function prepareAvatar(input:Buffer):Promise<Omit<AvatarImage,"sourceUrl">|null> {
  if (input.length<20||input.length>maximumInput) return null;
  if (input.readUInt32LE(0)===0x00010000) return ico(input);
  const image=await webp(input).catch(()=>null);
  return image?{image,contentType:"image/webp"}:null;
}

export function avatarCollector(wait:(url:URL,signal:AbortSignal)=>Promise<void>,proxy?:ProxyRoute) {
  const robots=new Map<string,ReturnType<Visit>>();
  const blocked=new Set<string>();
  const request=(binary:boolean):Visit=>async(url,signal,maxBytes)=>{
    const headers={"User-Agent":agent,Accept:binary?"image/*,*/*;q=0.1":"text/html,text/plain,application/xhtml+xml"};
    const read=async()=>{
      await wait(url,signal);
      if (!binary||url.pathname==="/robots.txt") return requestPublicNetwork(url,{signal,maxBytes,headers,proxy});
      const page=await requestPublicNetwork(url,{signal,maxBytes,headers,proxy,binary:true});
      return {...page,body:page.body.toString("base64")};
    };
    if (url.pathname!=="/robots.txt") return read();
    const existing=robots.get(url.href);
    if (existing) return existing;
    const pending=read();
    robots.set(url.href,pending);
    void pending.catch(()=>robots.delete(url.href));
    return pending;
  };
  return async (site:AvatarTarget):Promise<{avatar:AvatarImage|null;reason:string}>=>{
    const website=new URL(websiteUrl(site.website).url);
    if (blocked.has(website.origin)) return {avatar:null,reason:"网站要求访问验证或限流"};
    const page=await readPublicPage(website.href,request(false),360_000,8_000,0).catch(error=>{
      if (/HTTP (?:401|403|429|451|503)\b|要求访问验证/.test(String(error))) blocked.add(website.origin);
      throw error;
    });
    if (!/html/i.test(page.contentType)) return {avatar:null,reason:"公开页面不是 HTML"};
    const urls=declaredAvatarUrls(page.body,new URL(page.url),Boolean(site.hosted_storefront));
    if (!urls.length) return {avatar:null,reason:"店铺页面未公开独立标识"};
    for (const url of urls) {
      try {
        const asset=await readPublicPage(url,request(true),maximumInput,5500,0);
        if (asset.truncated) continue;
        const avatar=await prepareAvatar(Buffer.from(asset.body,"base64"));
        if (avatar) return {avatar:{...avatar,sourceUrl:asset.url},reason:"公开标识"};
      } catch (error) {
        if (/HTTP (?:401|403|429|451|503)\b|禁止此路径|要求访问验证/.test(String(error))) break;
      }
    }
    return {avatar:null,reason:"公开标识不可读取"};
  };
}
