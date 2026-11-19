import type { DatabaseSync } from "node:sqlite";
import { getGuide, guides } from "../catalog";
import { homeAds } from "../catalog/home-ads";
import { guideKindLabels } from "../catalog/types";
import { all, one, transaction } from "../directory/db";
import { isRetiredCategory, isRetiredNetworkSite } from "../directory/taxonomy";
import { choice, textValue } from "../directory/validation";
import { audit } from "../directory/write";
import { countryCode, isOverseasRule, visibilityModes, type VisibilityRule } from "./policy";
import { promotionKey, visibilityKinds, type VisibilityKind } from "./visibility";

type Target = { key: string; label: string; network?: boolean };
const contentQueries = {
  site: "SELECT slug key,name label,website secondary,category_slug FROM sites",
  category: "SELECT slug key,label,'' secondary,slug category_slug FROM categories",
  editorial: "SELECT slug key,title label,'' secondary,'' category_slug FROM editorials",
} as const;
type DirectoryTarget = Target & { secondary: string; category_slug: string };

function directoryTarget(kind: keyof typeof contentQueries, row: DirectoryTarget): Target {
  const network = kind === "site" ? isRetiredNetworkSite(row.category_slug,row.key) : kind === "category" && isRetiredCategory(row.key);
  return { key: row.key, label: row.label, network };
}

const guideTarget = (guide: typeof guides[number]): Target => ({
  key: guide.id, label: `${guide.title} · ${guideKindLabels[guide.kind]}`, network:guide.network,
});
const adTarget = (ad: typeof homeAds[number]): Target => ({ key: ad.id, label: ad.title, network:ad.network });

export function visibilityTarget(db: DatabaseSync, kind: VisibilityKind, key: string): Target | undefined {
  if (kind === "guide") {
    const guide=getGuide(key);
    return guide && guideTarget(guide);
  }
  if (kind === "ad") {
    const ad=homeAds.find(item=>item.id===key);
    return ad && adTarget(ad);
  }
  if (kind === "promotion") {
    const href=promotionKey(key);
    return href ? {key:href,label:href,network:homeAds.some(ad=>ad.network&&promotionKey(ad.href)===href)} : undefined;
  }
  const row=one<DirectoryTarget>(db,`SELECT * FROM (${contentQueries[kind]}) WHERE key=?`,key);
  return row && directoryTarget(kind,row);
}

export function visibilityTargets(db: DatabaseSync, kind: VisibilityKind, query:string, page:number) {
  const size=40;
  if (kind === "site" || kind === "category" || kind === "editorial") {
    const rows=all<DirectoryTarget>(db,`SELECT * FROM (${contentQueries[kind]})
      WHERE instr(lower(label),lower(?))>0 OR instr(lower(key),lower(?))>0 OR instr(lower(secondary),lower(?))>0
      ORDER BY label COLLATE NOCASE,key LIMIT ? OFFSET ?`,query,query,query,size+1,(page-1)*size);
    return rows.map(row=>directoryTarget(kind,row));
  }
  const promotionKeys=()=>[...new Set([
    ...homeAds.map(ad=>promotionKey(ad.href)!),
    ...all<{content_key:string}>(db,"SELECT content_key FROM content_region_rules WHERE kind='promotion' ORDER BY content_key").map(row=>row.content_key),
  ])].map(key=>visibilityTarget(db,"promotion",key)!);
  const rows=kind==="guide"?guides.map(guideTarget):kind==="ad"?homeAds.map(adTarget):promotionKeys();
  return rows.filter(row=>(row.label+" "+row.key).toLowerCase().includes(query.toLowerCase()))
    .slice((page-1)*size,page*size+1);
}

export function savedVisibility(db: DatabaseSync, kind: VisibilityKind, key: string): VisibilityRule {
  const row=one<{mode:VisibilityRule["mode"];countries:string}>(db,
    "SELECT mode,countries FROM content_region_rules WHERE kind=? AND content_key=?",kind,key);
  return row ? { mode:row.mode, countries:JSON.parse(row.countries) } : { mode:"all", countries:[] };
}

export function saveVisibility(db: DatabaseSync, fields:Record<string,string>, actor:string) {
  const kind=choice(fields.kind,Object.keys(visibilityKinds) as VisibilityKind[],"内容类型");
  const rawKey=textValue(fields.key,1500,"内容标识");
  const mode=choice(fields.mode,Object.keys(visibilityModes) as VisibilityRule["mode"][],"地区可见性");
  const rawCountries=mode==="countries"?textValue(fields.countries,1200,"国家或地区代码").split(/[,，\s]+/).filter(Boolean):[];
  const countries=[...new Set(rawCountries.map(countryCode))];
  if (countries.some(code=>!code) || (mode==="countries"&&!countries.length)) throw new Error("请输入有效的两位国家或地区代码，例如 HK、US。");
  const rule: VisibilityRule={ mode, countries:countries.filter((code): code is string=>!!code).sort() };
  return transaction(db,()=>{
    const target=visibilityTarget(db,kind,rawKey);
    if (!target) throw new Error("找不到对应内容，推广链接须为完整 HTTP 或 HTTPS 地址。");
    if (target.network && mode!=="all" && !isOverseasRule(rule)) throw new Error("此网络服务只能配置境外可见范围。");
    const before=savedVisibility(db,kind,target.key);
    if (before.mode===rule.mode&&before.countries.join(",")===rule.countries.join(",")) return target.key;
    if (mode==="all") db.prepare("DELETE FROM content_region_rules WHERE kind=? AND content_key=?").run(kind,target.key);
    else db.prepare(`INSERT INTO content_region_rules(kind,content_key,mode,countries,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(kind,content_key) DO UPDATE SET mode=excluded.mode,countries=excluded.countries,updated_at=excluded.updated_at`)
      .run(kind,target.key,mode,JSON.stringify(rule.countries),new Date().toISOString());
    audit(db,actor,"update","content_region_rules",`${kind}:${target.key}`,before,rule);
    return target.key;
  });
}
