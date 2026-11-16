import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { all, one, transaction } from "./db";
import type { ImportItem } from "./types";
import { choice,dateValue, now, recordId, slugValue, textValue, today, websiteUrl } from "./validation";
import { audit, merchantDetails,persist, type Fields } from "./write";
import { suggestCategory,operators,lifecycleLabels,pipelineForCategory } from "./taxonomy";
import { storefrontIdentity } from "./storefront-identity";

export const importLimits = { bytes: 8_000_000, rows: 5000 };
export type Format = "csv" | "json" | "urls";

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === "," || ch === "\r" || ch === "\n") {
      row.push(cell);
      cell = "";
      closed = false;
      if (ch !== ",") {
        rows.push(row);
        row = [];
        if (ch === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (ch === '"' && cell === "" && !closed) quoted = true;
    else if (ch === '"' || closed) throw new Error("CSV 引号格式无效。");
    else cell += ch;
  }
  if (quoted) throw new Error("CSV 有未关闭的引号。");
  if (row.length || cell || closed) rows.push([...row, cell]);
  return rows.filter((cols) => cols.some((value) => value.trim()));
}

export function parseImport(raw: string, format: Format): unknown[] {
  if (Buffer.byteLength(raw) > importLimits.bytes) throw new Error("导入内容过大（最多 8 MB）。");
  const text = raw.replace(/^\ufeff/, "").trim();
  let rows: unknown[];
  if (format === "urls") rows = text.split(/\r?\n/).filter(Boolean).map((url) => ({ url }));
  else if (format === "json") {
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("JSON 必须为数组。");
    rows = data;
  } else {
    const [header = [], ...records] = csvRows(text);
    const keys = header.map((value) => value.trim().toLowerCase());
    if (!keys.some((key) => key === "url" || key === "website") || new Set(keys).size !== keys.length) throw new Error("CSV 首行须包含唯一字段名，且包含 url。");
    rows = records.map((record) => record.length === keys.length ? Object.fromEntries(keys.map((key, index) => [key, record[index]])) : { invalid_row: record });
  }
  if (!rows.length || rows.length > importLimits.rows) throw new Error("每批须包含 1 至 5,000 条。");
  return rows;
}

export function extractMetadata(html: string) {
  const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/gi, (_, key: string) =>
    ({ amp:"&",lt:"<",gt:">",quot:'"',apos:"'","#39":"'","#x27":"'" })[key.toLowerCase()] ?? "");
  const clean = (text: string) => decode(text.replace(/<[^>]*>/g,"")).replace(/\s+/g," ").trim();
  const title = clean(/<title\b[^>]*>([^<]{0,700})<\/title\s*>/i.exec(html)?.[1] ?? "").slice(0,150);
  for (const tag of html.matchAll(/<meta\b[^>]{1,2000}>/gi)) {
    const attrs = Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map((m) => [m[1].toLowerCase(),m[2] ?? m[3] ?? m[4]]));
    if ([attrs.name,attrs.property].some((name) => /^(description|og:description)$/i.test(name ?? ""))) {
      return { title, description: clean(attrs.content ?? "").slice(0,380) };
    }
  }
  return { title, description:"" };
}

const merchantBasics=["products","payments","contact","fees","renewal","refunds","regions"] as const;
type Candidate = { url: string; name: string; summary: string; category: string; source_url: string; source_title: string; excerpt: string; snapshot_at: string; ai_draft?: string;
  basics:Partial<Record<typeof merchantBasics[number],string>>; source_kind:"official"|"pending";
  basis:"standard"|"basic"|"official"; publication_evidence:string; approval_key:string; website_language:string|null;
  discovery_name:string; license_url:string|null; operator_kind:string; lifecycle:string; merchant_details:Record<string,string>; aliases:string; historical_domains:string; domain_aliases:string };
const nameKey = (name:string) => name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"");

export function candidate(raw: unknown): { data: Candidate; domain: string; registrable:string; name:string } {
  if (typeof raw === "string") raw = { url:raw };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("记录必须是网址或 JSON 对象。");
  const input = raw as Fields;
  if (input.coverage_error) throw new Error(textValue(input.coverage_error,150,"导入错误"));
  const site = websiteUrl(textValue(input.url ?? input.website,1500,"网址"));
  const basis=choice(input.basis??"standard",["standard","basic","official"],"档案依据");
  const source = websiteUrl(textValue(input.source_url ?? site.url,1500,"来源网址"));
  const html = textValue(input.html,125_000,"公开网页 HTML",false);
  const metadata = extractMetadata(html);
  const name = textValue(input.name,100,"名称",false) || metadata.title.slice(0,100) || site.domain;
  const summary = textValue(input.summary,380,"简介",false);
  const category = textValue(input.category,90,"分类",false) || suggestCategory(`${site.domain} ${name} ${summary} ${metadata.description}`);
  const details = input.merchant_details && typeof input.merchant_details === "object" ? input.merchant_details as Fields : input;
  const basics = input.basics && typeof input.basics === "object" ? input.basics as Fields : input;
  const domains = (key:string) => [...new Set(textValue(input[key],2000,"附加域名",false).split(/[,，\n]+/).map(s=>s.trim()).filter(Boolean).map(s=>websiteUrl(s).domain))].join(",");
  const license = textValue(input.license_url,1500,"数据许可",false);
  const evidence=textValue(input.publication_evidence,1500,"发布依据",false);
  const language=textValue(input.website_language,30,"网站语言",false);
  if (language && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/i.test(language)) throw new Error("网站语言代码无效。");
  const data:Candidate = {
    url:basis==="basic"?new URL(site.url).origin+"/":site.url,name,summary,category,source_url:source.url,
    source_title:textValue(input.source_title,150,"来源标题",false) || metadata.title || "公开来源入口",
    excerpt:textValue(input.excerpt,2600,"存档摘录",false) || metadata.description,
    snapshot_at:input.snapshot_at ? dateValue(input.snapshot_at,"访问日期") : today(),
    discovery_name:textValue(input.discovery_name,180,"发现来源",false),
    source_kind:choice(input.source_kind??"pending",["pending","official"],"来源性质"),
    basis,
    publication_evidence:evidence?websiteUrl(evidence).url:"",
    approval_key:textValue(input.approval_key,64,"管线凭证",false),
    website_language:language||null,
    basics:Object.fromEntries(merchantBasics.flatMap(key=>{
      const value=textValue(basics[key],1000,key,false);
      return value?[[key,value]]:[];
    })),
    license_url:license?websiteUrl(license).url:null,
    operator_kind:choice(input.operator_kind ?? "unknown",Object.keys(operators),"运营性质"),
    lifecycle:choice(input.lifecycle ?? "unknown",Object.keys(lifecycleLabels),"运营状态"),
    merchant_details:merchantDetails(details),
    aliases:textValue(input.aliases,700,"名称别名",false),
    historical_domains:domains("historical_domains"),domain_aliases:domains("domain_aliases"),
    ...(input.ai_draft ? { ai_draft:textValue(input.ai_draft,1400,"AI 草稿",false) } : {}),
  };
  return { domain:site.domain, registrable:site.registrable, name:nameKey(name), data };
}

const duplicate = (db: DatabaseSync, domain: string) => one(db,"SELECT site_id FROM site_domains WHERE domain=?",domain);
export function createImport(db: DatabaseSync, raw: string, format: Format, actor: string, withinTransaction=false) {
  const input = parseImport(raw,format);
  function write() {
    const batch = Number(db.prepare("INSERT INTO import_batches(format,created_at) VALUES (?,?)").run(format,now()).lastInsertRowid);
    const domains = new Set<string>();
    const insert = db.prepare("INSERT INTO import_items(batch_id,payload,domain,state,message,registrable,normalized_name,discovery_key) VALUES (?,?,?,?,?,?,?,?)");
    const addSource = db.prepare("INSERT OR IGNORE INTO candidate_sources(item_id,source_url,source_name,license_url,acquired_at) VALUES (?,?,?,?,?)");
    const prior = db.prepare("SELECT id,payload,state FROM import_items WHERE discovery_key=?");
    const pending = db.prepare("SELECT id FROM import_items WHERE domain=? AND state IN ('ready','approved') ORDER BY id LIMIT 1");
    const registered = db.prepare("SELECT site_id FROM site_domains WHERE domain=?");
    const primaryFamily = db.prepare("SELECT site_id FROM site_domains WHERE registrable=? LIMIT 1");
    const pendingFamily = db.prepare("SELECT id FROM import_items WHERE registrable=? AND state IN ('ready','approved','published') ORDER BY id LIMIT 1");
    let inserted=0, skipped=0, linked=0, refreshed=0;
    for (const row of input) {
      try {
        const { data, domain,registrable,name } = candidate(row);
        const discoveryKey = data.discovery_name ? JSON.stringify([data.discovery_name,domain]) : null;
        const previous = discoveryKey ? prior.get(discoveryKey) as {id:number;payload:string;state:string}|undefined : undefined;
        if (previous) {
          addSource.run(previous.id,data.source_url,data.discovery_name,data.license_url,data.snapshot_at);
          const old=JSON.parse(previous.payload) as Candidate;
          if (previous.state==="ready" && data.source_url===old.source_url && data.snapshot_at>old.snapshot_at) {
            db.prepare("UPDATE import_items SET payload=? WHERE id=?").run(JSON.stringify({...old,snapshot_at:data.snapshot_at,
              ...(old.summary?{}:{name:data.name,category:data.category,excerpt:data.excerpt,operator_kind:data.operator_kind})}),previous.id);
            db.prepare("UPDATE candidate_sources SET acquired_at=?,license_url=? WHERE item_id=? AND source_url=?").run(data.snapshot_at,data.license_url,previous.id,data.source_url);
            refreshed++;
          } else skipped++;
          continue;
        }
        const exactPending=pending.get(domain) as {id:number}|undefined;
        const pendingMatch = (exactPending ?? (data.basis!=="standard"?pendingFamily.get(registrable):undefined)) as {id:number}|undefined;
        const publishedMatch = (registered.get(domain) ?? (data.basis!=="standard"?primaryFamily.get(registrable):undefined)) as {site_id:number}|undefined;
        const repeat = domains.has(domain) || !!publishedMatch || !!pendingMatch;
        domains.add(domain);
        const item = Number(insert.run(batch,JSON.stringify(data),domain,repeat?"duplicate":"ready",repeat?"主机或所属注册域已经登记或进入审核，同主体证据待人工确认。":"",registrable,name,discoveryKey).lastInsertRowid);
        inserted++;
        if (data.discovery_name) {
          addSource.run(item,data.source_url,data.discovery_name,data.license_url,data.snapshot_at);
          if (exactPending && !publishedMatch) {
            linked += Number(addSource.run(exactPending.id,data.source_url,data.discovery_name,data.license_url,data.snapshot_at).changes);
          }
          if (publishedMatch) {
            audit(db,actor,"duplicate_candidate_source","sites",publishedMatch.site_id,null,{item,source:data.source_url});
          }
        }
      } catch (error) {
        insert.run(batch,JSON.stringify(row),null,"failed",error instanceof Error ? error.message : "无法处理该条。",null,null,null);
        inserted++;
      }
    }
    audit(db,actor,"preview","import_batches",batch,null,{format,rows:input.length,inserted,skipped,linked,refreshed});
    return batch;
  }
  return withinTransaction?write():transaction(db,write);
}

export function sourceEvidence(db:DatabaseSync,id:number) {
  return all<{source_url:string;source_name:string;license_url:string|null;acquired_at:string}>(db,
    "SELECT source_url,source_name,license_url,acquired_at FROM candidate_sources WHERE item_id=? ORDER BY id",id);
}

export function getBatch(batch: number, db: DatabaseSync) {
  return all<ImportItem>(db,"SELECT * FROM import_items WHERE batch_id=? ORDER BY id",batch);
}

export function previewPage(db:DatabaseSync,batch:number,state:string,page:number) {
  const size=40;
  return {
    counts:all<{state:ImportItem["state"];n:number}>(db,"SELECT state,count(*) n FROM import_items WHERE batch_id=? GROUP BY state",batch),
    rows:all<ImportItem>(db,"SELECT * FROM import_items WHERE batch_id=? AND (?='' OR state=?) ORDER BY id LIMIT ? OFFSET ?",batch,state,state,size,(page-1)*size),
    size,
  };
}

export function conflicts(db:DatabaseSync,row:ImportItem) {
  const name=(JSON.parse(row.payload) as Candidate|null)?.name??null;
  return all<{domain:string;name:string;site_id:number|null}>(db,`SELECT domain,s.name,site_id FROM site_domains d JOIN sites s ON s.id=d.site_id
    WHERE d.domain<>? AND (d.registrable=? OR (d.kind='primary' AND coalesce(?,'')<>''
      AND (lower(s.name)=lower(?) OR EXISTS(SELECT 1 FROM json_each(s.aliases) WHERE lower(value)=lower(?)))))
    UNION SELECT i.domain,json_extract(i.payload,'$.name'),NULL FROM import_items i
    WHERE i.id<>? AND i.domain<>? AND i.state IN ('ready','approved')
    AND (i.registrable=? OR (length(?)>=3 AND i.normalized_name=?)) LIMIT 8`,
    row.domain,row.registrable,name,name,name,row.id,row.domain,row.registrable,row.normalized_name,row.normalized_name);
}

function cannotApprove(db:DatabaseSync,data:Candidate,row:ImportItem) {
  if (storefrontIdentity(data.url)) return "平台店铺按独立链接收录，请使用带公开人民币标价的店铺批次。";
  if (!one(db,"SELECT 1 FROM categories WHERE slug=? AND parent_slug IS NOT NULL",data.category)) return "人工审核时须选择有效子分类。";
  if (data.lifecycle==="closed") return "新候选不能直接标记停运，须先为档案登记经过核实的停运来源。";
  if ((data.category==="ai-subscriptions" && data.operator_kind==="third_party") ||
      (["ai-topup","ai-card","ai-relay"].includes(data.category) && data.operator_kind==="official")) return "分类与运营性质冲突。";
  if (data.basis==="basic" || data.basis==="official") {
    if (one(db,`SELECT 1 FROM merchant_admission_decisions a JOIN merchant_candidates c ON c.id=a.candidate_id
      WHERE a.item_id=? AND a.outcome=? AND c.registrable=? AND json_extract(a.evidence,'$.name')=?
      AND json_extract(a.evidence,'$.website')=? AND json_extract(a.evidence,'$.category')=?
      AND json_extract(a.evidence,'$.source')=? AND json_extract(a.evidence,'$.note')=?
      AND json_extract(a.evidence,'$.sourceKind')=? AND json_extract(a.evidence,'$.date')=?`,row.id,
      data.basis==="basic"?"basic":"verified",row.registrable,data.name,data.url,data.category,data.source_url,data.excerpt,
      data.source_kind,data.snapshot_at)) {
      if (one(db,"SELECT 1 FROM site_domains WHERE registrable=?",row.registrable)) return "所属注册域已登记。";
      return "";
    }
    const source=one<{access:string;evidence_url:string;pipeline:string}>(db,"SELECT access,evidence_url,pipeline FROM coverage_runs WHERE batch_id=? AND fingerprint=?",row.batch_id,data.approval_key);
    if (!source || source.evidence_url!==data.publication_evidence ||
        (data.basis==="basic"? !["licensed","submission","official"].includes(source.access):source.access!=="official")) return "此档案需匹配经审计的授权来源或官网管线。";
    if (pipelineForCategory(data.category)!==source.pipeline) return "分类与来源所属管线不一致。";
    if (one(db,"SELECT 1 FROM site_domains WHERE registrable=?",websiteUrl(data.url).registrable)) return "所属注册域已登记，须确认是否为同一商家。";
    if (data.basis==="basic") {
      if (data.name===websiteUrl(data.url).domain ||
          (source.access==="licensed"&&data.license_url!==source.evidence_url) ||
          (source.access==="submission"&&data.source_url!==source.evidence_url) ||
          (source.access==="official"&&(data.source_kind!=="official"||websiteUrl(data.url).registrable!==websiteUrl(data.source_url).registrable))) {
        return "基础档案须有真实商家名称及可复核的授权或同主体官网。";
      }
      return "";
    }
    if (data.source_kind!=="official" || !data.excerpt || websiteUrl(data.url).registrable!==websiteUrl(data.source_url).registrable) {
      return "官网已核实档案须有同主体官网证据及原创核验说明。";
    }
  }
  if (!data.summary) return "人工审核时须填写已检查的档案简介。";
  return "";
}

export function approvalIssue(db:DatabaseSync,row:ImportItem) {
  try {
    if (row.message.startsWith("暂缓审核：")) return row.message;
    const {data,domain}=candidate(JSON.parse(row.payload));
    return cannotApprove(db,data,row) || (duplicate(db,domain)?"域名已存在":"");
  } catch (error) {
    return error instanceof Error? error.message:"候选无法验证。";
  }
}

export function holdCandidate(db:DatabaseSync,id:number,reason:string,actor:string) {
  transaction(db,()=>{
    const row=one<ImportItem>(db,"SELECT * FROM import_items WHERE id=? AND state IN ('ready','approved')",id);
    if (!row) throw new Error("请选择待审核或已批准的条目。");
    const message=`暂缓审核：${textValue(reason,250,"暂缓原因")}`;
    db.prepare("UPDATE import_items SET state='ready',message=? WHERE id=?").run(message,id);
    audit(db,actor,"hold","import_items",id,{state:row.state,message:row.message},{state:"ready",message});
  });
}

export function reviseItem(db: DatabaseSync, id: number, raw: string, actor: string, approved: boolean, withinTransaction=false) {
  const write=() => {
    const row = one<ImportItem>(db,"SELECT * FROM import_items WHERE id=?",id);
    if (!row || row.state === "published") throw new Error("导入项不存在或已发布。");
    const input=JSON.parse(raw) as Fields | string;
    const scope=one<{fingerprint:string;evidence_url:string;access:string;pipeline:string}>(db,
      "SELECT fingerprint,evidence_url,access,pipeline FROM coverage_runs WHERE batch_id=?",row.batch_id);
    const { data,domain,registrable,name } = candidate(scope&&input&&typeof input==="object"&&!Array.isArray(input)?
      {...input,approval_key:scope.fingerprint,publication_evidence:scope.evidence_url,basis:scope.access==="official"&&input.basis!=="basic"?"official":"basic",
        license_url:scope.access==="licensed"?scope.evidence_url:null}:input);
    if (scope&&data.category&&scope.pipeline!==pipelineForCategory(data.category)) throw new Error("更正后的分类仍不属于该批次管线。");
    const already = duplicate(db,domain) || one(db,"SELECT 1 FROM import_items WHERE id<>? AND domain=? AND state IN ('ready','approved','published')",id,domain) ||
      (data.basis!=="standard" && (one(db,"SELECT 1 FROM site_domains WHERE registrable=?",registrable)||
        one(db,"SELECT 1 FROM import_items WHERE id<>? AND registrable=? AND state IN ('ready','approved','published')",id,registrable)));
    if (approved && !already) {
      const reason=cannotApprove(db,data,row);
      if (reason) throw new Error(reason);
    }
    const state = already ? "duplicate" : approved ? "approved" : "ready";
    const sameWebsite=(JSON.parse(row.payload) as Candidate | null)?.url===data.url;
    const previous=JSON.parse(row.payload) as {website_title?:string;website_description?:string}|null;
    const metadata=sameWebsite&&previous?{website_title:previous.website_title,website_description:previous.website_description}:{};
    db.prepare(`UPDATE import_items SET payload=?,domain=?,registrable=?,normalized_name=?,state=?,message=?,
      reachability=?,checked_at=?,check_detail=?,final_url=? WHERE id=?`).run(JSON.stringify({...data,...metadata}),domain,registrable,name,state,already?"域名已收录或已在审核队列。":"",
      sameWebsite?row.reachability:"unchecked",sameWebsite?row.checked_at:null,sameWebsite?row.check_detail:"",sameWebsite?row.final_url:null,id);
    if (data.discovery_name) {
      const key=JSON.stringify([data.discovery_name,domain]);
      if (!one(db,"SELECT 1 FROM import_items WHERE id=? AND discovery_key IS NOT NULL",id) &&
          !one(db,"SELECT 1 FROM import_items WHERE discovery_key=? AND id<>?",key,id)) {
        db.prepare("UPDATE import_items SET discovery_key=? WHERE id=?").run(key,id);
      }
      db.prepare("INSERT OR IGNORE INTO candidate_sources(item_id,source_url,source_name,license_url,acquired_at) VALUES (?,?,?,?,?)")
        .run(id,data.source_url,data.discovery_name,data.license_url,data.snapshot_at);
    }
    audit(db,actor,approved?"approve":"retry","import_items",id,{state:row.state,payload:JSON.parse(row.payload)},{state,payload:data});
    return row.batch_id;
  };
  return withinTransaction?write():transaction(db,write);
}

export function approveItems(db:DatabaseSync,batch:number,ids:number[],actor:string,withinTransaction=false) {
  const write=()=>{
    let count=0;
    const flags:string[]=[];
    for (const id of [...new Set(ids)].slice(0,importLimits.rows)) {
      const row=one<ImportItem>(db,"SELECT * FROM import_items WHERE id=? AND batch_id=? AND state='ready'",id,batch);
      if (!row) continue;
      const reason=approvalIssue(db,row);
      if (reason) { flags.push(`#${id} ${reason}`);continue; }
      db.prepare("UPDATE import_items SET state='approved' WHERE id=?").run(id);
      audit(db,actor,"approve","import_items",id,{state:row.state},{state:"approved"});
      count++;
    }
    return {count,flags};
  };
  return withinTransaction?write():transaction(db,write);
}

export function publishBatch(db: DatabaseSync, batchId: number, actor: string, selected?:number[],withinTransaction=false) {
  const write=()=>{
    const rows = all<ImportItem>(db,`SELECT * FROM import_items WHERE batch_id=? AND state='approved'
      AND (? IS NULL OR id IN (SELECT value FROM json_each(?))) ORDER BY id`,batchId,selected?1:null,JSON.stringify(selected??[]));
    let published = 0;
    for (const row of rows) {
      db.exec("SAVEPOINT import_row");
      try {
        const { data,domain,registrable } = candidate(JSON.parse(row.payload));
        const reason=cannotApprove(db,data,row);
        if (reason) throw new Error(reason);
        if (duplicate(db,domain)) {
          db.prepare("UPDATE import_items SET state='duplicate',message=? WHERE id=?").run("审核后该域名已由其他批次登记。",row.id);
        } else {
          const base = domain.replace(/[^a-z0-9]+/g,"-").slice(0,75).replace(/-$/,"");
          const slug = one(db,"SELECT 1 FROM sites WHERE slug=?",base) ? `${base}-${row.id}` : base;
          const basic=data.basis==="basic";
          const official=data.basis==="official";
          const site = persist(db,"sites",{ slug:slugValue(slug),name:data.name,website:data.url,category_slug:data.category,summary:basic?"":data.summary,
            aliases:JSON.stringify(basic?[]:data.aliases.split(/[,，\n]+/).map(s=>s.trim()).filter(Boolean)),
            operator_kind:basic?"unknown":data.operator_kind,lifecycle:basic?"unknown":data.lifecycle,
            ...(basic?{}:data.basics),merchant_details:JSON.stringify(basic?{}:data.merchant_details),reachability:row.reachability,checked_at:row.checked_at,
            status:official?"verified":"listed",basis:data.basis,verified_at:official?data.snapshot_at:null,website_language:data.website_language,
            publication:"published",added_at:now(),updated_at:now() });
          const register=db.prepare("INSERT INTO site_domains(domain,site_id,kind,registrable) VALUES (?,?,?,?)");
          register.run(domain,site,"primary",registrable);
          for (const [list,kind] of basic?[]:[[data.domain_aliases,"alias"],[data.historical_domains,"historical"]]) {
            for (const value of list.split(",").filter(Boolean)) {
              register.run(value,site,kind,websiteUrl(value).registrable);
              db.prepare(`INSERT OR IGNORE INTO candidate_sources(item_id,source_url,source_name,license_url,acquired_at)
                SELECT ?,c.source_url,c.source_name,c.license_url,c.acquired_at FROM candidate_sources c
                JOIN import_items i ON c.item_id=i.id WHERE i.domain=?`).run(row.id,value);
              db.prepare(`UPDATE import_items SET state='duplicate',site_id=?,message=?
                WHERE domain=? AND state IN ('ready','approved')`).run(site,`已作为 ${domain} 的${kind==="alias"?"别名":"历史域名"}登记。`,value);
            }
          }
          const archivedAt = (JSON.parse(row.payload) as Candidate).snapshot_at;
          const excerpt=basic?"":data.excerpt;
          const admission=one<{credit:string;sourceKind:string}>(db,`SELECT json_extract(evidence,'$.credit') credit,json_extract(evidence,'$.sourceKind') sourceKind
            FROM merchant_admission_decisions WHERE item_id=? AND outcome IN ('verified','basic') ORDER BY run_id DESC LIMIT 1`,row.id);
          db.prepare(`INSERT INTO sources(site_id,title,url,accessed_at,kind,verified,excerpt,digest,attribution,license_url) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
            site,data.source_title,data.source_url,archivedAt,basic?(admission?.sourceKind??"pending"):data.source_kind,Number(official),excerpt,excerpt?createHash("sha256").update(excerpt).digest("hex"):"",data.discovery_name||admission?.credit||null,data.license_url);
          db.prepare(`INSERT OR IGNORE INTO sources(site_id,title,url,accessed_at,kind,verified,attribution,license_url)
            SELECT ?,source_name,source_url,acquired_at,'pending',0,source_name,license_url FROM candidate_sources WHERE item_id=?`).run(site,row.id);
          if (official) db.prepare(`INSERT OR IGNORE INTO merchant_site_tags(site_id,tag,source_url)
            SELECT ?,t.value,? FROM merchant_candidates c,json_each(c.details,'$.tags') t
            WHERE c.item_id=? AND json_extract(c.details,'$.url')=? AND json_extract(c.details,'$.category')=? AND t.type='text'`)
            .run(site,data.source_url,row.id,data.source_url,data.category);
          db.prepare("UPDATE import_items SET state='published',site_id=?,message='' WHERE id=?").run(site,row.id);
          audit(db,actor,"publish","sites",site,null,{slug,publication:"published",batch:batchId});
          published++;
        }
        db.exec("RELEASE import_row");
      } catch {
        db.exec("ROLLBACK TO import_row; RELEASE import_row;");
        db.prepare("UPDATE import_items SET state='failed',message=? WHERE id=?").run("发布失败，请检查分类和资料后重试。",row.id);
      }
    }
    audit(db,actor,"publish","import_batches",batchId,null,{published,total:rows.length});
    return published;
  };
  return withinTransaction?write():transaction(db,write);
}

export async function assistDraft(db: DatabaseSync, id: number, actor: string) {
  const endpoint = process.env.EDITOR_AI_ENDPOINT;
  if (!endpoint) throw new Error("尚未配置编辑摘要服务。");
  const row = one<ImportItem>(db,"SELECT * FROM import_items WHERE id=?",recordId(id));
  if (!row || row.state === "published") throw new Error("导入项不存在或已发布。");
  const { data } = candidate(JSON.parse(row.payload));
  if (!data.excerpt) throw new Error("请先存入可公开引用的来源摘录。");
  const headers: Record<string,string> = { "Content-Type":"application/json" };
  if (process.env.EDITOR_AI_TOKEN) headers.Authorization = `Bearer ${process.env.EDITOR_AI_TOKEN}`;
  const res = await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({name:data.name,source:data.source_url,excerpt:data.excerpt}),
    redirect:"error",signal:AbortSignal.timeout(7000),cache:"no-store"});
  if (!res.ok) throw new Error("摘要服务暂不可用。");
  const result = await boundedText(res, 8192);
  const draft = textValue((JSON.parse(result) as {summary?:string}).summary,1400,"AI 草稿");
  return transaction(db,() => {
    const saved=db.prepare("UPDATE import_items SET payload=?,state='ready',message='' WHERE id=? AND payload=? AND state=?")
      .run(JSON.stringify({...data,ai_draft:draft}),id,row.payload,row.state);
    if (!saved.changes) throw new Error("导入项已发生变化，请刷新后重试。");
    audit(db,actor,"ai_draft","import_items",id,null,{source:data.source_url});
    return row.batch_id;
  });
}

export async function boundedText(stream: Request | Response, limit: number) {
  if (Number(stream.headers.get("content-length")) > limit) throw new Error("提交内容过大。");
  const reader = stream.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let result = "";
  let bytes = 0;
  while (true) {
    const { value,done } = await reader.read();
    if (done) return result + decoder.decode();
    bytes += value.byteLength;
    if (bytes > limit) { await reader.cancel(); throw new Error("提交内容过大。"); }
    result += decoder.decode(value,{stream:true});
  }
}
