import type { DatabaseSync } from "node:sqlite";
import { all,one,transaction } from "./db";
import type { DiscoverySource } from "./discovery";
import { discoverFrom,type Found,type Lead } from "./discovery-providers";
import { merchantSearchLead } from "./discovery-rules";
import { now,websiteUrl } from "./validation";
import { readPublicPage } from "./website-check";

export const sourceAdapters=["standard","provider-json","provider-markdown","licensed-snapshot","sitemap-partners","merchant-partners"] as const;
type Adapter=typeof sourceAdapters[number];
type Read=typeof readPublicPage;

function publicLink(value:string,start:string) {
  try {
    const url=websiteUrl(new URL(value.replace(/&amp;/g,"&"),start).href);
    const clean=new URL(url.url);
    if (/[?&](?:aff|ref|invite|token|code|coupon|key)=/i.test(clean.search) || /\/(?:invite|refer|aff|redirect|go)\//i.test(clean.pathname)) return undefined;
    clean.search="";
    return clean.href;
  } catch { return undefined; }
}

function partnerLinks(body:string,url:string):Lead[] {
  const own=websiteUrl(url).registrable;
  const lead:Lead[]=[];
  const seen=new Set<string>();
  for (const match of body.matchAll(/<a\b([^>]{0,1300})>([\s\S]{0,300}?)<\/a>/gi)) {
    const raw=match[1].match(/\bhref\s*=\s*["']([^"'<>]{1,1100})["']/i)?.[1];
    if (!raw || /\brel\s*=\s*["'][^"']*sponsored/i.test(match[1])) continue;
    const context=body.slice(Math.max(0,match.index-150),match.index+match[0].length+60).replace(/<[^>]+>/g," ");
    if (!/合作|伙伴|友链|商家|服务商|partner|integration|platform|storefront|affiliate/i.test(context)) continue;
    const target=publicLink(raw,url);
    if (!target || websiteUrl(target).registrable===own || seen.has(target)) continue;
    seen.add(target);
    lead.push({url:target,evidence:url});
    if (lead.length>=100) break;
  }
  return lead;
}

function providerJson(body:string,evidence:string):Lead[] {
  const data=JSON.parse(body) as unknown;
  if (!data || typeof data!=="object") return [];
  const section=(data as {providers?:unknown}).providers??data;
  if (typeof section!=="object"||!section) return [];
  return Object.values(section).slice(0,500).flatMap(node=>{
    if (!node||typeof node!=="object") return [];
    const row=node as Record<string,unknown>;
    const options=[row.website,row.homepage,row.website_url,row.official_url,row.url,row.doc,row.api].flatMap(value=>{
      if (typeof value!=="string"||!/^https?:\/\//i.test(value)) return [];
      return [publicLink(value,evidence)].filter((url):url is string=>!!url);
    });
    const endpoint=typeof row.api==="string"&&/^https?:\/\//i.test(row.api)?publicLink(row.api,evidence):undefined;
    const target=endpoint?(options.find(url=>websiteUrl(url).registrable===websiteUrl(endpoint).registrable)||endpoint):options[0];
    if (!target) return [];
    const origin=new URL(target).origin+"/";
    return [{url:origin,evidence,name:typeof row.name==="string"?row.name:undefined},...options.filter(url=>url!==origin&&url!==endpoint&&
      websiteUrl(url).registrable===websiteUrl(target).registrable).slice(0,1).map(url=>({url,evidence}))];
  });
}

function providerMarkdown(body:string,evidence:string):Lead[] {
  const lead:Lead[]=[];
  const seen=new Set<string>();
  const registryHosts=new Set(["github.com","githubusercontent.com","jsdelivr.net","shields.io"]);
  for(const line of body.split(/\r?\n/)) {
    if (!line.trimStart().startsWith("|") || !/https?:\/\//i.test(line)) continue;
    for (const match of line.matchAll(/(?:\]\(|`)(https?:\/\/[^\s)`|]+)[)`]/gi)) {
      const link=publicLink(match[1],evidence);
      if (!link||registryHosts.has(websiteUrl(link).registrable)||websiteUrl(link).registrable===websiteUrl(evidence).registrable) continue;
      const url=new URL(link).origin+"/";
      if (seen.has(url)) continue;
      seen.add(url);
      lead.push({url,evidence});
      if(lead.length>=400) return lead;
    }
  }
  return lead;
}

async function collect(source:DiscoverySource,adapter:Adapter,read:Read,manual?:Lead[]):Promise<Found> {
  if (source.access==="restricted") throw new Error("来源授权不允许采集");
  if (["brave","deepseek"].includes(source.kind)) throw new Error("付费搜索必须走请求台账");
  if (adapter==="licensed-snapshot") {
    if (source.kind!=="dataset"||source.access!=="licensed"||!manual?.length||manual.length>5000) throw new Error("需要具备复用许可的数据集和 1 至 5,000 条本地线索。");
    return {leads:manual.map(lead=>({...lead,evidence:source.url})),errors:[]};
  }
  if (adapter==="standard") return discoverFrom(source,{read,manual});
  if (adapter==="sitemap-partners") {
    if (source.kind!=="sitemap"||source.access!=="official") throw new Error("必须选择已审计的官方 Sitemap");
    const result=await discoverFrom(source,{read});
    const pages=result.leads.filter(lead=>/\/(?:partners?|integrations?|links|friends?|about|docs?)(?:[/.]|$)/i.test(new URL(lead.url).pathname)).slice(0,5);
    if (!pages.length) return {...result,errors:[...result.errors,"Sitemap 中未发现符合范围的合作页面"]};
    const leads=[...result.leads];
    for(const row of pages) {
      try { const page=await read(row.url);leads.push(...partnerLinks(page.body,page.url)); }
      catch { result.errors.push("部分合作页面无法按规则获取"); }
    }
    return {...result,leads};
  }
  if (adapter==="merchant-partners"&&source.access!=="leads"&&source.access!=="official") throw new Error("需要已核对的公开链接来源");
  if (adapter!=="merchant-partners"&&source.access!=="licensed") throw new Error("数据集需要明确复用许可");
  const exportFormat=adapter==="provider-json"&&new URL(source.url).search==="?format=json";
  const page=await read(source.url,undefined,adapter==="provider-json"?12_000_000:720_000,undefined,undefined,exportFormat);
  if (page.truncated) throw new Error("来源体积超过允许的读取上限");
  const leads=adapter==="provider-json"?providerJson(page.body,page.url):adapter==="provider-markdown"?providerMarkdown(page.body,page.url):partnerLinks(page.body,page.url);
  return {leads,errors:[]};
}

export async function intakeMerchantSource(db:DatabaseSync,campaign:number,sourceId:number,adapter:Adapter,read:Read=readPublicPage,manual?:Lead[]) {
  const source=one<DiscoverySource>(db,"SELECT * FROM discovery_sources WHERE id=?",sourceId);
  if (!source || !one(db,"SELECT 1 FROM merchant_campaigns WHERE id=?",campaign)) throw new Error("来源或采集任务不存在");
  let found:Found={leads:[],errors:[]};
  let failed=false;
  if (source.access!=="restricted") {
    try { found=await collect(source,adapter,read,manual); }
    catch (error) { failed=true;found.errors.push(error instanceof Error?error.message:"读取来源失败"); }
  }
  return transaction(db,()=>{
    const current=one<DiscoverySource>(db,"SELECT * FROM discovery_sources WHERE id=?",sourceId);
    const allowed=source.access!=="restricted"&&current?.access===source.access&&current.evidence_url===source.evidence_url&&current.url===source.url&&current.pipeline===source.pipeline&&current.kind===source.kind;
    const state=allowed?failed?"failed":found.errors.length?"partial":"ok":"restricted";
    const id=Number(db.prepare(`INSERT INTO merchant_source_runs(campaign_id,source_id,source_snapshot,adapter,created_at,state,returned,error)
      VALUES (?,?,?,?,?,?,?,?)`).run(campaign,sourceId,JSON.stringify(source),adapter,now(),state,allowed?found.leads.length:0,
      allowed?found.errors.join("；").slice(0,600):"授权限制，本次未写入线索").lastInsertRowid);
    if (!allowed||failed) return {id,state,links:0};
    const link=db.prepare("INSERT OR IGNORE INTO merchant_source_links(run_id,candidate_id,url,evidence_url,name_hint,filter_reason) VALUES (?,?,?,?,?,?)");
    let links=0;
    for(const lead of found.leads.slice(0,5000)) {
      const raw=publicLink(lead.url,source.url);
      const evidence=publicLink(lead.evidence??source.url,source.url)??source.url;
      if (!raw) continue;
      try {
        const {target,rootOnly}=merchantSearchLead(raw);
        const known=one(db,"SELECT 1 FROM site_domains WHERE registrable=?",target.registrable);
        db.prepare("INSERT OR IGNORE INTO merchant_candidates(campaign_id,registrable,pipeline,state) VALUES (?,?,?,?)")
          .run(campaign,target.registrable,source.pipeline,known?"known":"queued");
        const row=one<{id:number}>(db,"SELECT id FROM merchant_candidates WHERE campaign_id=? AND registrable=?",campaign,target.registrable)!;
        links+=Number(link.run(id,row.id,rootOnly?raw:target.url,evidence,lead.name?.slice(0,100)??"","").changes);
      } catch (error) {
        links+=Number(link.run(id,null,raw,evidence,"",error instanceof Error?error.message:"网址不可核查").changes);
      }
    }
    return {id,state,links};
  });
}

export function merchantSourceReport(db:DatabaseSync,campaign:number) {
  return all<{source:string;domains:number;novel:number;checked:number;verified:number;published_with_source:number;published_first_source:number}>(db,`WITH sightings AS (
    SELECT u.candidate_id,'DeepSeek Search' source,r.started_at moment FROM merchant_urls u JOIN merchant_requests r ON r.id=u.request_id
    WHERE r.campaign_id=? AND u.candidate_id IS NOT NULL
    UNION ALL SELECT l.candidate_id,json_extract(r.source_snapshot,'$.name'),r.created_at
    FROM merchant_source_links l JOIN merchant_source_runs r ON r.id=l.run_id WHERE r.campaign_id=? AND l.candidate_id IS NOT NULL
  ), first_hit AS (
    SELECT candidate_id,source,row_number() OVER(PARTITION BY candidate_id ORDER BY moment,source) ordinal FROM sightings
  ), cohort AS (
    SELECT DISTINCT h.source,h.candidate_id,c.state,i.state review,
      NOT EXISTS(SELECT 1 FROM merchant_candidates prior WHERE prior.registrable=c.registrable AND prior.campaign_id<c.campaign_id) AND c.state<>'known' AS novel
    FROM sightings h JOIN merchant_candidates c ON c.id=h.candidate_id LEFT JOIN import_items i ON i.id=c.item_id
  ) SELECT h.source,count(*) domains,sum(h.novel) novel,
    count(CASE WHEN h.state IN ('ready','manual','unverified','filtered','rejected') THEN 1 END) checked,
    count(CASE WHEN h.state='ready' THEN 1 END) verified,
    count(CASE WHEN h.review='published' THEN 1 END) published_with_source,
    count(CASE WHEN h.review='published' AND f.source=h.source THEN 1 END) published_first_source
  FROM cohort h JOIN first_hit f ON f.candidate_id=h.candidate_id AND f.ordinal=1 GROUP BY h.source ORDER BY domains DESC`,campaign,campaign);
}
