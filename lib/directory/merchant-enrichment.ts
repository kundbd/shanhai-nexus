import type { DatabaseSync } from "node:sqlite";
import { one,transaction } from "./db";
import { parseMerchantMetadata } from "./discovery-providers";
import { cleanTitle } from "./discovery-rules";
import { readDujiaoStorefront } from "./dujiao-storefront";
import { saveMerchantAvatar,type AvatarTarget } from "./merchant-avatar";
import { avatarCollector } from "./merchant-avatar-collection";
import { merchantNameKey } from "./merchant-evidence";
import { assessAutomatedAdmission,publicMerchantText,type LeadPage } from "./merchant-lead-page";
import { parseProxy } from "./network-transport";
import { addServiceQuotes,privateRefreshPath,readShopObservation,refreshAccessRule,saveShopObservation } from "./refresh-discovery";
import { structuredPublicQuotes } from "./refresh-quotes";
import { storefrontIdentity } from "./storefront-identity";
import type { StorefrontObservation } from "./storefront-import";
import { isRetiredCategory,pipelineForCategory,publicPipelines,type Pipeline } from "./taxonomy";
import { websiteUrl } from "./validation";
import { readPublicPage,websiteVisit,type Visit } from "./website-check";

export type MerchantTarget=Pick<AvatarTarget,"name"|"website">&{category_slug:string};
export type EnrichmentOptions={visit?:Visit;collectAvatar?:ReturnType<typeof avatarCollector>;stop?:AbortSignal};
type Dujiao=NonNullable<Awaited<ReturnType<typeof readDujiaoStorefront>>>;

function sameShopName(candidate:string|undefined,submitted:string) {
  const name=merchantNameKey(submitted);
  const actual=merchantNameKey(candidate??"");
  return name.length>=2&&actual.length>=2&&(actual.includes(name)||name.includes(actual));
}

function officialImportName(page:LeadPage,registrable:string,submitted:string) {
  const {title,siteName}=parseMerchantMetadata(page.body);
  const labels=title.split(/[|｜·]|\s+[–—-]\s+/).map(cleanTitle).filter(Boolean);
  const heading=merchantNameKey(cleanTitle(/<h1\b[^>]*>([\s\S]{0,400}?)<\/h1>/i.exec(page.body)?.[1]??""));
  const stem=merchantNameKey(registrable.split(".")[0]);
  const keys=[stem,stem+"ai",stem+"api"];
  const isDomainBrand=(label:string)=>stem.length>=3&&keys.includes(merchantNameKey(label));
  const key=merchantNameKey(submitted);
  return [...labels,cleanTitle(siteName??"")].find(isDomainBrand)
    ??labels.find(label=>heading&&label.length<=45&&merchantNameKey(label)===heading)
    ??labels.find(label=>label.length<=45&&merchantNameKey(label)===key);
}

async function readMerchantHome(db:DatabaseSync,website:string,{visit,stop}:EnrichmentOptions) {
  const original=websiteUrl(website);
  const restricted=refreshAccessRule(db);
  const request=visit??websiteVisit(parseProxy(process.env.MERCHANT_PROXY),{compressed:true});
  const storefront=storefrontIdentity(original.url);
  const read:Visit=(url,signal,bytes)=>{
    if (websiteUrl(url.href).registrable!==original.registrable||privateRefreshPath.test(url.pathname)||restricted(url.href)) {
      throw new Error("来源限制或跳离商家公开页面");
    }
    return request(url,stop?AbortSignal.any([signal,stop]):signal,bytes);
  };
  const home=await readPublicPage(original.url,read,720_000,16_000,0);
  if (home.truncated||!/html/i.test(home.contentType)||(storefront&&storefrontIdentity(home.url)?.key!==storefront.key)) {
    throw new Error("尚未取得完整的同店铺公开页面");
  }
  return {original,home,read,storefront};
}

async function inspectMerchantPages(target:MerchantTarget,pipeline:Pipeline,{home,read,storefront}:Awaited<ReturnType<typeof readMerchantHome>>) {
  const retail=pipeline==="ai-retail";
  const catalog=retail?await readDujiaoStorefront(home,read).catch(()=>undefined):undefined;
  const pages:LeadPage[]=[home];
  const assessment=assessAutomatedAdmission(pipeline,home);
  if (!catalog&&assessment.detail&&assessment.detail!==home.url) {
    const detail=await readPublicPage(assessment.detail,read,720_000,12_000,0).catch(()=>undefined);
    if (detail&&!detail.truncated&&/html/i.test(detail.contentType)&&(!storefront||storefrontIdentity(detail.url)?.key===storefront.key)) pages.push(detail);
  }
  const findings=pages.map(page=>({page,review:page===home?assessment:assessAutomatedAdmission(pipeline,page)}));
  const verified=findings.find(({page,review})=>review.outcome==="merchant"&&!review.checkout&&review.category&&
    pipelineForCategory(review.category)===pipeline&&!isRetiredCategory(review.category)&&
    (sameShopName(review.name,target.name)||sameShopName(review.title,target.name)||page!==home&&sameShopName(assessment.name,target.name)));
  const namedCatalog=catalog&&sameShopName(catalog.name,target.name)?catalog:undefined;
  const evidence=namedCatalog?.titles.length?{
    category:target.category_slug,url:home.url,text:[namedCatalog.name,...namedCatalog.titles].join("\n").slice(0,5600),
  }:verified?{
    category:verified.review.category!,url:verified.page.url,text:publicMerchantText(verified.page),
  }:undefined;
  return {home,pages,catalog:namedCatalog,evidence,hosted:!!storefront};
}

export async function inspectMerchant(db:DatabaseSync,target:MerchantTarget,options:EnrichmentOptions={}) {
  const pipeline=pipelineForCategory(target.category_slug);
  if (!pipeline||isRetiredCategory(target.category_slug)||privateRefreshPath.test(new URL(websiteUrl(target.website).url).pathname)) {
    throw new Error("当前投稿不属于可自动审核的公开商家类别");
  }
  return inspectMerchantPages(target,pipeline,await readMerchantHome(db,target.website,options));
}

export async function inspectImportMerchant(db:DatabaseSync,candidate:MerchantTarget,options:EnrichmentOptions) {
  const entry=await readMerchantHome(db,candidate.website,options);
  const preferred=pipelineForCategory(candidate.category_slug);
  const matches=new Map<string,ReturnType<typeof assessAutomatedAdmission>>();
  for (const pipeline of ["connections",...publicPipelines] as const) {
    const assessment=assessAutomatedAdmission(pipeline,entry.home);
    if (assessment.outcome==="merchant"&&assessment.category&&!assessment.checkout) matches.set(assessment.category,assessment);
  }
  const active=[...matches.keys()].filter(category=>!isRetiredCategory(category));
  const retired=[...matches.keys()].find(isRetiredCategory);
  if (retired&&!active.length) return {retired};
  const category=active.find(value=>pipelineForCategory(value)===preferred)??(active.length===1?active[0]:candidate.category_slug);
  const pipeline=pipelineForCategory(category);
  if (!pipeline||isRetiredCategory(category)) return {};
  const detected=matches.get(category)?.name;
  const domainName=merchantNameKey(entry.original.registrable);
  const assessedName=merchantNameKey(detected??"");
  const name=officialImportName(entry.home,entry.original.registrable,candidate.name)
    ??(detected&&assessedName&&assessedName!==domainName?detected:candidate.name);
  if (merchantNameKey(name).length<2||[domainName,merchantNameKey(entry.original.domain)].includes(merchantNameKey(name))) return {};
  const target={name,website:candidate.website,category_slug:category};
  const inspection=await inspectMerchantPages(target,pipeline,entry);
  return {target,inspection};
}

type Inspection=Awaited<ReturnType<typeof inspectMerchant>>;

export async function collectOfficialAvatar(db:DatabaseSync,target:MerchantTarget,inspection:Inspection,options:EnrichmentOptions={}) {
  const collect=options.collectAvatar??avatarCollector(async()=>{},{
    proxy:parseProxy(process.env.MERCHANT_PROXY),restricted:refreshAccessRule(db),stop:options.stop,
  });
  return collect({id:0,slug:"",name:target.name,website:target.website,hosted_storefront:inspection.hosted?1:0},
    {...inspection.home,icon:inspection.catalog?.icon}).catch(()=>({avatar:null,reason:"官网图标暂时无法读取"}));
}

function catalogObservation(catalog:Dujiao,target:MerchantTarget,category:StorefrontObservation["category"],sourceUrl:string,stamp:string):StorefrontObservation {
  return {name:target.name,website:target.website,sourceUrl,observedAt:stamp,category,offers:catalog.offers};
}

export function merchantStorefrontObservations(target:MerchantTarget,inspection:Inspection,stamp:string) {
  const category=target.category_slug;
  if (category!=="ai-card"&&category!=="ai-topup") return [];
  return inspection.catalog?.offers.length?
    [catalogObservation(inspection.catalog,target,category,inspection.home.url,stamp)]:
    inspection.pages.map(page=>readShopObservation(page,stamp,target.name,category))
      .filter((item):item is StorefrontObservation=>!!item&&sameShopName(item.name,target.name));
}

export function saveMerchantAssets(db:DatabaseSync,target:MerchantTarget&{id:number},inspection:Inspection,
  avatar:Awaited<ReturnType<typeof collectOfficialAvatar>>,stamp:string,actor:string) {
  let quotes=0;
  let checked=0;
  const category=target.category_slug;
  if (category==="ai-card"||category==="ai-topup") {
    for (const observation of merchantStorefrontObservations(target,inspection,stamp)) {
      checked+=observation.offers.length;
      const saved=saveShopObservation(db,{...observation,website:target.website},target.id,actor);
      quotes+=saved.prices;
    }
  } else {
    for (const page of inspection.pages) {
      const recorded=addServiceQuotes(db,target.id,{url:page.url,category,regionQuotes:structuredPublicQuotes(page.body,page.url,stamp)},stamp);
      checked+=recorded.checked;
      quotes+=recorded.changed;
    }
  }
  saveMerchantAvatar(db,target,avatar.avatar,avatar.reason,stamp);
  const hasAvatar=!!one(db,"SELECT 1 FROM merchant_avatars WHERE site_id=? AND digest IS NOT NULL",target.id);
  return {checked,quotes,hasAvatar};
}

export async function enrichPublishedMerchant(db:DatabaseSync,slug:string,options:EnrichmentOptions={}) {
  const sql="SELECT id,slug,name,website,category_slug FROM sites WHERE slug=? AND publication='published' AND lifecycle<>'closed'";
  const target=one<MerchantTarget&{id:number;slug:string}>(db,sql,slug);
  if (!target) throw new Error("未找到可更新的公开商家");
  const inspection=await inspectMerchant(db,target,options);
  if (!inspection.evidence) throw new Error("官网尚缺可对应到此商家的公开商品或服务证据");
  const avatar=await collectOfficialAvatar(db,target,inspection,options);
  options.stop?.throwIfAborted();
  return transaction(db,()=>{
    const current=one<typeof target>(db,sql,slug);
    if (!current||current.id!==target.id||current.website!==target.website||current.category_slug!==target.category_slug||current.name!==target.name) {
      throw new Error("商家资料已变更，请重新核对");
    }
    return {slug,...saveMerchantAssets(db,target,inspection,avatar,new Date().toISOString(),"merchant-enrichment")};
  });
}
