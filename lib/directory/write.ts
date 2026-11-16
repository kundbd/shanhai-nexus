import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { all, one, transaction } from "./db";
import { editorialOrigins, natures, statuses, type Editorial } from "./types";
import { choice, dateValue, now, recordId, slugValue, textValue, today, websiteUrl } from "./validation";
import { deliveryLabels,lifecycleLabels,merchantFields,operators } from "./taxonomy";
import { storefrontIdentity } from "./storefront-identity";

export type Fields = Record<string, unknown>;
export type Entity = "sites" | "categories" | "sources" | "editorials" | "price_records" | "incidents" | "submissions";
export const entities: Entity[] = ["sites", "categories", "sources", "editorials", "price_records", "incidents", "submissions"];
const publication = ["draft", "published", "archived"] as const;
const sourceKinds = Object.keys(natures) as (keyof typeof natures)[];

export function audit(db: DatabaseSync, actor: string, action: string, entity: string, id: string | number, before: unknown, after: unknown) {
  db.prepare(`INSERT INTO audit_log(actor,action,entity,entity_id,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?)`).run(
    actor, action, entity, String(id), before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), now());
}

type Values = Record<string, SQLInputValue>;
export function persist(db: DatabaseSync, table: Entity, values: Values, id?: string | number) {
  const keys = Object.keys(values);
  const key = table === "categories" ? "slug" : "id";
  if (id != null) {
    db.prepare(`UPDATE ${table} SET ${keys.map((name) => `${name}=?`).join(",")} WHERE ${key}=?`).run(...Object.values(values),id);
    return id;
  }
  const result = db.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(values));
  return table === "categories" ? String(values.slug) : Number(result.lastInsertRowid);
}

function sourceAllowed(db: DatabaseSync, id: number, owner?: number | null) {
  const source = one<{ id: number; site_id: number | null; kind: string; verified: number }>(db, "SELECT * FROM sources WHERE id=?", id);
  if (!source || (owner != null && source.site_id !== owner && source.site_id !== null)) throw new Error("来源不存在或归属不匹配。");
  return source;
}

export function merchantDetails(fields:Fields) {
  const details:Record<string,string>= {};
  for (const [key,label] of Object.entries(merchantFields)) {
    const field = textValue(fields[key],400,label,false);
    if (!field) continue;
    if (key==="delivery_methods") {
      const methods = [...new Set(field.split(/[,，\s]+/))];
      if (!methods.every(method=>Object.hasOwn(deliveryLabels,method))) throw new Error("交付类型须使用 topup、code、account、seat 或 other。");
      details[key]=methods.join(",");
    } else details[key]=field;
  }
  return details;
}

function saveSite(db: DatabaseSync, fields: Fields, previous?: Fields, id?: number) {
  const website = websiteUrl(textValue(fields.website,1500,"官网"));
  const storefront = storefrontIdentity(website.url);
  const storedStorefront = storefront && id && one(db,"SELECT 1 FROM merchant_storefronts WHERE storefront_key=? AND site_id=?",storefront.key,id);
  const unchanged = previous?.website === website.url;
  if (storefront && !storedStorefront && !unchanged) throw new Error("平台店铺须通过带公开商品标价的店铺批次登记。");
  if (previous?.website && storefrontIdentity(String(previous.website)) && !unchanged && !storedStorefront) throw new Error("请先通过店铺证据批次登记新的关联链接。");
  const domainOwner = id && one(db,"SELECT 1 FROM site_domains WHERE site_id=? AND kind='primary'",id);
  const hosted = !!storedStorefront && (!domainOwner || !unchanged);
  const domains = new Map<string,string>(hosted ? [] : [[website.domain, "primary"]]);
  for (const [key, kind] of [["domain_aliases","alias"],["historical_domains","historical"]] as const) {
    for (const entry of textValue(fields[key],2400,"附加域名",false).split(/[\n,，]+/).map(s=>s.trim()).filter(Boolean)) {
      const { domain } = websiteUrl(entry);
      if (domains.has(domain)) throw new Error(`域名重复：${domain}`);
      domains.set(domain, kind);
    }
  }
  if (hosted) {
    const known = all<{domain:string;kind:string}>(db,"SELECT domain,kind FROM site_domains WHERE site_id=? AND kind<>'primary'",id!);
    if (known.length!==domains.size || known.some(entry=>domains.get(entry.domain)!==entry.kind)) {
      throw new Error("平台店铺的别名须通过店铺证据批次登记。");
    }
  }
  if (domains.size > 30) throw new Error("每个档案最多登记 30 个域名。");
  for (const domain of domains.keys()) {
    const other = one<{ site_id: number }>(db, "SELECT site_id FROM site_domains WHERE domain=?", domain);
    if (other && other.site_id !== id) throw new Error(`域名已经登记：${domain}`);
  }
  const status = choice(fields.status ?? "listed",Object.keys(statuses),"资料状态");
  const visibility = choice(fields.publication ?? "draft",publication,"发布状态");
  const operator = choice(fields.operator_kind ?? previous?.operator_kind ?? "unknown",Object.keys(operators),"运营性质");
  const lifecycle = choice(fields.lifecycle ?? previous?.lifecycle ?? "unknown",Object.keys(lifecycleLabels),"运营状态");
  const category = slugValue(fields.category_slug);
  if ((category === "ai-subscriptions" && operator === "third_party") ||
      (["ai-relay","ai-topup","ai-card"].includes(category) && operator === "official")) throw new Error("分类与运营性质冲突。");
  if (lifecycle === "closed" && previous?.lifecycle !== "closed" && !one(db,"SELECT 1 FROM sources WHERE site_id=? AND verified=1",id ?? null)) {
    throw new Error("标记停运前须保存已核实的停运来源。");
  }
  const verifiedAt = status === "listed" ? null : dateValue(fields.verified_at || today(),"最近核实日期");
  if (verifiedAt && !one(db, `SELECT 1 FROM sources src WHERE src.site_id=? AND src.verified=1 AND src.accessed_at<=?
    AND (?='verified' OR src.kind='tested') AND NOT EXISTS (SELECT 1 FROM price_records p
      WHERE p.source_id=src.id AND p.reported_item_url IS NOT NULL)`, id ?? null,verifiedAt,status)) {
    throw new Error("提升资料状态前，须先保存相符且已核实的来源；实测需要站方实测证据。");
  }
  if (verifiedAt && previous?.website && websiteUrl(String(previous.website)).domain !== website.domain) {
    throw new Error("切换主域名须先将档案降为已收录，并核实新域名来源。");
  }
  const values: Values = {
    slug: previous ? String(previous.slug) : slugValue(fields.slug),
    name: textValue(fields.name,100,"服务商名称"),
    website: website.url,
    category_slug: category,
    summary: textValue(fields.summary,380,"简介",status!=="listed"||previous?.basis!=="basic"),
    aliases: JSON.stringify(textValue(fields.aliases,700,"名称别名",false).split(/[,，\n]+/).map(s=>s.trim()).filter(Boolean)),
    status,
    publication: visibility,
    operator_kind:operator,
    lifecycle,
    merchant_details:JSON.stringify(merchantDetails(fields)),
    verified_at: verifiedAt, updated_at: now(),
  };
  if (!previous) values.added_at = now();
  if (previous?.website && website.url !== previous.website) {
    values.reachability="unchecked";
    values.checked_at=null;
  }
  for (const key of ["contact","products","payments","fees","renewal","refunds","regions"]) values[key] = textValue(fields[key],1000,key,false) || null;
  const siteId = Number(persist(db,"sites",values,id));
  if (hosted) {
    if (domainOwner) db.prepare("UPDATE site_domains SET kind='historical' WHERE site_id=? AND kind='primary'").run(siteId);
    return siteId;
  }
  db.prepare("DELETE FROM site_domains WHERE site_id=?").run(siteId);
  for (const [domain,kind] of domains) db.prepare("INSERT INTO site_domains(domain,site_id,kind,registrable) VALUES (?,?,?,?)")
    .run(domain,siteId,kind,websiteUrl(domain).registrable);
  return siteId;
}

function saveCategory(db: DatabaseSync, fields: Fields, id?: string) {
  const slug = id ?? slugValue(fields.slug);
  const parent = fields.parent_slug ? slugValue(fields.parent_slug) : null;
  if (parent && (parent === slug || one(db,`WITH RECURSIVE children(slug) AS (SELECT slug FROM categories
    WHERE parent_slug=? UNION SELECT c.slug FROM categories c JOIN children p ON c.parent_slug=p.slug)
    SELECT 1 FROM children WHERE slug=?`,slug,parent))) throw new Error("分类不能形成循环。");
  const position = Number(fields.position || 0);
  if (!Number.isSafeInteger(position) || position < 0 || position > 999) throw new Error("顺序须为 0–999 的整数。");
  return persist(db,"categories",{slug,label:textValue(fields.label,45,"分类名称"),description:textValue(fields.description,160,"描述"),parent_slug:parent,position},id);
}

function editedDate(value:unknown,label:string,previous:unknown) {
  const date=dateValue(value,label);
  return typeof previous==="string"&&previous.slice(0,10)===date?previous:date;
}

function saveSource(db: DatabaseSync, fields: Fields, id?: number, previous?: Fields) {
  const kind = choice(fields.kind,sourceKinds,"来源性质");
  const verified = fields.verified === "1" && kind !== "pending" ? 1 : 0;
  const excerpt = textValue(fields.excerpt,2600,"存档摘录",false);
  if (verified && !excerpt) throw new Error("核实来源时，须保存可复核的摘录或核验说明。");
  const accessedAt = editedDate(fields.accessed_at,"访问日期",previous?.accessed_at);
  const siteId = fields.site_id ? recordId(fields.site_id) : null;
  const url = websiteUrl(textValue(fields.url,1500,"原始链接")).url;
  if (previous && siteId !== previous.site_id) throw new Error("已保存来源的归属不可更改。");
  if (previous && (kind !== previous.kind || !verified || accessedAt !== previous.accessed_at || url !== previous.url) && one(db,`SELECT 1 WHERE
    EXISTS(SELECT 1 FROM editorial_claims WHERE source_id=?)
    OR EXISTS(SELECT 1 FROM incidents WHERE source_id=?)
    OR EXISTS(SELECT 1 FROM price_records WHERE source_id=?)
    OR EXISTS(SELECT 1 FROM sites s WHERE s.id=? AND s.status<>'listed' AND ?=1)`,id!,id!,id!,siteId,Number(previous.verified))) {
    throw new Error("此来源已被引用或用于核实状态。如需修订日期或性质，请先解除引用或另建来源。");
  }
  return persist(db,"sources",{
    site_id:siteId,title:textValue(fields.title,150,"来源标题"),url,
    accessed_at:accessedAt,kind,verified,excerpt,digest:excerpt ? createHash("sha256").update(excerpt).digest("hex") : "",
    attribution:fields.attribution==null ? String(previous?.attribution??"")||null : textValue(fields.attribution,150,"发布者"),
  },id);
}

function saveEditorial(db: DatabaseSync, fields: Fields, id?: number, previous?: Fields) {
  const owner = fields.site_id ? recordId(fields.site_id) : null;
  const visibility = choice(fields.publication,publication,"发布状态");
  const origin = choice(fields.origin ?? previous?.origin ?? "editorial",Object.keys(editorialOrigins) as Editorial["origin"][],"文章归属");
  const raw = JSON.parse(textValue(fields.claims,18000,"判断清单",false) || "[]") as unknown;
  if (!Array.isArray(raw) || raw.length > 24) throw new Error("判断清单须为至多 24 条的 JSON 数组。");
  const claims = raw.map((row: Fields) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("判断条目格式无效。");
    const nature = choice(row.nature,sourceKinds,"信息性质");
    const source = row.source_id ? sourceAllowed(db,recordId(row.source_id),owner) : null;
    if (nature !== "pending" && (!source || source.kind !== nature || (visibility === "published" && !source.verified))) {
      throw new Error("事实判断需要相同性质的来源，发布前必须核实。");
    }
    return { label:textValue(row.label,80,"判断标签"), statement:textValue(row.statement,800,"判断内容"),nature,source };
  });
  if (visibility === "published" && !claims.some(c=>c.nature !== "pending")) throw new Error("发布观察至少需要一项有来源的已核实判断。");
  if (origin === "third_party" && visibility === "published" && !claims.some(c=>c.nature === "media")) throw new Error("发布第三方测评需要经过核实的第三方原文链接。");
  const newId = Number(persist(db,"editorials",{
    slug:previous ? String(previous.slug) : slugValue(fields.slug),site_id:owner,title:textValue(fields.title,150,"标题"),
    summary:textValue(fields.summary,380,"摘要"),body:textValue(fields.body,14000,"编辑正文"),publication:visibility,origin,updated_at:now(),
  },id));
  db.prepare("DELETE FROM editorial_claims WHERE editorial_id=?").run(newId);
  for (const row of claims) db.prepare("INSERT INTO editorial_claims(editorial_id,label,statement,nature,source_id) VALUES (?,?,?,?,?)").run(
    newId,row.label,row.statement,row.nature,row.source?.id ?? null);
  return newId;
}

function saveRecord(db: DatabaseSync, entity: "price_records" | "incidents", fields: Fields, id?: number, previous?:Fields) {
  const owner = recordId(fields.site_id);
  const sourceId = recordId(fields.source_id);
  const visibility = choice(fields.publication,publication,"发布状态");
  const source = sourceAllowed(db,sourceId,owner);
  if (visibility === "published" && !source.verified) throw new Error("记录发布前须核实来源。");
  const base = { site_id: owner, source_id: sourceId, publication: visibility };
  if (entity === "incidents") return persist(db,entity,{
    ...base,title:textValue(fields.title,180,"事件标题"),summary:textValue(fields.summary,2000,"事件摘要"),
    kind:choice(fields.kind,["price","policy","status","other"],"事件分类"),occurred_at:dateValue(fields.occurred_at,"事件日期"),
  },id);
  const amount = textValue(fields.amount_minor,12,"最小货币单位金额");
  if (!/^\d{1,12}$/.test(amount)) throw new Error("金额须为非负整数，使用最小货币单位。");
  const currency = textValue(fields.currency,3,"币种").toUpperCase();
  if (!Intl.supportedValuesOf("currency").includes(currency)) throw new Error("币种须使用受支持的三位 ISO 货币代码。");
  const scale=fields.amount_scale==null||fields.amount_scale===""?previous?.amount_scale??null:Number(fields.amount_scale);
  if (scale!==null && (typeof scale!=="number"||!Number.isInteger(scale)||scale<0||scale>6)) throw new Error("小数位数须为 0–6 的整数。");
  const values = {
    ...base,plan:textValue(fields.plan,150,"套餐"),amount_minor:Number(amount),amount_scale:scale,currency,period:textValue(fields.period,45,"计费周期"),
    region:textValue(fields.region,80,"计价地区"),notes:textValue(fields.notes,400,"备注",false),recorded_at:editedDate(fields.recorded_at,"记录日期",previous?.recorded_at),
  };
  if (previous?.reported_item_url && (["site_id","source_id","plan","amount_minor","amount_scale","currency","period","region","recorded_at"] as const)
    .some(key=>previous[key]!==values[key])) throw new Error("第三方观测报价须使用原始证据重新导入。");
  return persist(db,entity,values,id);
}

function snapshot(db: DatabaseSync, entity: Entity, id: number | string) {
  const current = one<Fields>(db,`SELECT * FROM ${entity} WHERE ${entity === "categories" ? "slug" : "id"}=?`,id);
  if (current && entity === "sites") current.domains = all(db,"SELECT domain,kind FROM site_domains WHERE site_id=? ORDER BY domain",id);
  if (current && entity === "editorials") current.claims = all(db,"SELECT label,statement,nature,source_id FROM editorial_claims WHERE editorial_id=? ORDER BY id",id);
  return current;
}

export function writeEntity(db: DatabaseSync, entity: Entity, fields: Fields, actor: string, action = "save") {
  return transaction(db, () => writeEntityInTransaction(db,entity,fields,actor,action));
}

export function writeEntityInTransaction(db: DatabaseSync, entity: Entity, fields: Fields, actor: string, action = "save") {
    const id = fields.id ? (entity === "categories" ? slugValue(fields.id) : recordId(fields.id)) : undefined;
    const previous = id != null ? snapshot(db,entity,id) : undefined;
    if (id != null && !previous) throw new Error("记录不存在。");
    if (action === "delete") {
      if (!previous || id == null || entity === "submissions") throw new Error("该条目不能删除。");
      if (entity === "sites" && (previous.publication !== "draft" || one(db,"SELECT 1 FROM audit_log WHERE entity='sites' AND entity_id=? AND json_extract(after_json,'$.publication')='published'",String(id)))) {
        throw new Error("已公开的档案须归档，不能删除。");
      }
      if (entity === "sources" && previous.verified && previous.site_id != null && one(db,"SELECT 1 FROM sites WHERE id=? AND status<>'listed'",recordId(previous.site_id))) throw new Error("请先降级依赖此证据的档案核实状态。");
      db.prepare(`DELETE FROM ${entity} WHERE ${entity === "categories" ? "slug" : "id"}=?`).run(id);
      audit(db,actor,"delete",entity,id,previous,null);
      return id;
    }
    let savedId: string | number;
    const numeric = typeof id === "number" ? id : undefined;
    switch (entity) {
      case "sites": savedId = saveSite(db,fields,previous,numeric); break;
      case "categories": savedId = saveCategory(db,fields,typeof id === "string" ? id : undefined); break;
      case "sources": savedId = saveSource(db,fields,numeric,previous); break;
      case "editorials": savedId = saveEditorial(db,fields,numeric,previous); break;
      case "price_records":
      case "incidents": savedId = saveRecord(db,entity,fields,numeric,previous); break;
      case "submissions":
        if (numeric == null) throw new Error("投稿来自公开投稿入口。");
        savedId = persist(db,entity,{moderation:choice(fields.moderation,["pending","accepted","rejected"],"审核状态"),
          review_note:textValue(fields.review_note,700,"审核备注",false)},numeric);
    }
    audit(db,actor,previous ? "update" : "create",entity,savedId,previous,snapshot(db,entity,savedId));
    return savedId;
}

export type ThirdPartyObservation = {
  slug:string;
  merchant:string;
  title:string;
  summary:string;
  body:string;
  source:{url:string;title:string;publisher:string;accessedAt:string};
};

export function importThirdPartyObservation(db: DatabaseSync, entry: ThirdPartyObservation, actor: string) {
  return transaction(db, () => {
    const owner=one<{id:number}>(db,"SELECT id FROM sites WHERE slug=? AND publication='published'",entry.merchant);
    if (!owner) throw new Error(`无公开商家档案：${entry.merchant}`);
    const slug=slugValue(entry.slug);
    const url=websiteUrl(entry.source.url).url;
    const existing=one<Editorial>(db,"SELECT * FROM editorials WHERE slug=?",slug);
    if (existing) {
      const matched=existing.origin==="third_party" && existing.site_id===owner.id && one(db,`SELECT 1 FROM editorial_claims c
        JOIN sources s ON s.id=c.source_id WHERE c.editorial_id=? AND c.nature='media' AND s.url=?`,existing.id,url);
      if (!matched) throw new Error(`已存在归属或来源不同的观察：${slug}`);
      return false;
    }
    if (one(db,`SELECT 1 FROM editorials e JOIN editorial_claims c ON c.editorial_id=e.id
      JOIN sources s ON s.id=c.source_id WHERE e.site_id=? AND e.origin='third_party' AND s.url=?`,owner.id,url)) return false;
    const priorSource=one<{id:number}>(db,`SELECT id FROM sources WHERE site_id=? AND url=? AND accessed_at=? AND kind='media' AND verified=1`,owner.id,url,entry.source.accessedAt);
    const sourceId=priorSource?.id ?? writeEntityInTransaction(db,"sources",{
      site_id:String(owner.id),kind:"media",verified:"1",url,title:entry.source.title,attribution:entry.source.publisher,
      accessed_at:entry.source.accessedAt,excerpt:entry.summary,
    },actor,"save");
    writeEntityInTransaction(db,"editorials",{
      site_id:String(owner.id),publication:"published",origin:"third_party",slug,title:entry.title,summary:entry.summary,body:entry.body,
      claims:JSON.stringify([{label:"原文与测试范围",statement:`${entry.source.publisher} · 来源查阅于 ${entry.source.accessedAt}。`,nature:"media",source_id:sourceId}]),
    },actor,"save");
    return true;
  });
}
