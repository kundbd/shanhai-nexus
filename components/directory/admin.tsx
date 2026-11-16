import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminActor,sessionCookie } from "@/lib/directory/auth";
import { adminLabels,type AdminRow } from "@/lib/directory/admin-read";
import { listCategories } from "@/lib/directory/read";
import { editorialOrigins,incidentLabels,natures,statuses } from "@/lib/directory/types";
import { lifecycleLabels,merchantFields,operators,reachabilityLabels } from "@/lib/directory/taxonomy";
import type { Entity } from "@/lib/directory/write";
import { today } from "@/lib/directory/validation";
import { param,type Params } from "./catalog-page";

export async function requireAdmin() {
  const actor = adminActor((await cookies()).get(sessionCookie)?.value);
  if (!actor) redirect("/admin/login");
  return actor;
}
export function AdminNav() {
  return <nav className="admin-nav" aria-label="后台栏目"><Link href="/admin">管理首页</Link>{Object.entries(adminLabels).map(([key,label])=><Link key={key} href={`/admin/${key}`}>{label}</Link>)}<Link href="/admin/moderation">DSH 审核</Link></nav>;
}
export function Notice({input}:{input:Params}) {
  const error = param(input.error);
  const ok = param(input.ok);
  return <>{error && <p role="alert" className="form-error">{error.slice(0,200)}</p>}{ok && <p role="status" className="form-notice">{ok.slice(0,200)}</p>}</>;
}
type Field = {name:string;label:string;type?:"textarea"|"date"|"number";options?:Record<string,string>;wide?:boolean;optional?:boolean;hint?:string};
const publish = {draft:"草稿",published:"已发布",archived:"已归档"};
const field = (name:string,label:string,opts:Omit<Field,"name"|"label">={}):Field=>({name,label,...opts});
const select = (name:string,label:string,options:Record<string,string>,optional=false)=>field(name,label,{options,optional});
const textarea = (name:string,label:string,optional=false)=>field(name,label,{type:"textarea",wide:true,optional});
const visibility = select("publication","发布状态",publish);
const linkId = field("slug","链接标识",{hint:"创建后保持稳定"});
const siteId = field("site_id","服务编号",{type:"number",hint:"在服务商管理列表查看编号"});
const optionalSite = {...siteId,optional:true,label:"服务编号（通栏文章或共用来源可留空）"};
const sourceId = field("source_id","来源编号",{type:"number",hint:"在来源管理列表查看编号"});
const dateField = (name:string,label:string,optional=false)=>field(name,label,{type:"date",optional});
function fieldsFor(entity:Entity):Field[] {
  switch(entity) {
    case "sites": return [
      linkId,field("name","服务商名称"),field("website","官方网站"),select("category_slug","分类",Object.fromEntries(listCategories().map((item)=>[item.slug,item.label]))),
      textarea("summary","一句话简介（基础档案可留空）",true),textarea("aliases","名称别名，逐行或逗号分隔",true),
      textarea("domain_aliases","别名域名，逐行分隔",true),textarea("historical_domains","历史域名，逐行分隔",true),
      ...([["contact","公开联系方式"],["products","主要产品"],["payments","付款方式"],["fees","手续费"],["renewal","续费与计费"],["refunds","退款与售后"],["regions","地区与限制"]] as const).map(([key,label])=>textarea(key,label,true)),
      select("operator_kind","运营性质",operators),select("lifecycle","运营状态",lifecycleLabels),
      ...Object.entries(merchantFields).map(([key,label])=>field(key,label,{optional:true,...key==="delivery_methods"&&{hint:"以逗号分隔：topup 代充、code 卡密、account 成品号、seat 共享席位、other 其他。"}})),
      select("status","资料状态",statuses),dateField("verified_at","最近核实日期",true),visibility,
    ];
    case "categories": return [linkId,field("label","分类名称"),textarea("description","描述"),
      select("parent_slug","父分类",Object.fromEntries(listCategories().map((item)=>[item.slug,item.label])),true),field("position","排序位置",{type:"number",optional:true})];
    case "sources": return [optionalSite,field("title","来源标题"),field("url","原始链接"),dateField("accessed_at","访问日期"),select("kind","来源性质",natures),
      select("verified","核实状态",{"0":"待核实","1":"已核实"}),textarea("excerpt","存档摘录或核验说明",true)];
    case "editorials": return [linkId,optionalSite,field("title","标题"),visibility,select("origin","文章归属",editorialOrigins),textarea("summary","摘要"),textarea("body","整理正文（纯文本）"),
      {...textarea("claims","判断清单（JSON）",true),hint:'例如 [{"label":"价格","statement":"公开报价为……","nature":"official","source_id":12}]。性质可填 official、tested、media、user、pending。'}];
    case "price_records": return [siteId,sourceId,field("plan","套餐"),field("currency","币种（例如 USD）"),field("amount_minor","金额（按小数位数放大的整数）",{type:"number"}),
      field("amount_scale","小数位数",{type:"number",optional:true,hint:"留空时使用币种默认小数位，已有报价沿用原小数位数。"}),
      field("period","计费周期"),field("region","计价地区"),dateField("recorded_at","记录日期"),visibility,textarea("notes","备注",true)];
    case "incidents": return [siteId,sourceId,field("title","事件标题"),select("kind","事件类别",incidentLabels),dateField("occurred_at","事件日期"),visibility,textarea("summary","事件说明")];
    case "submissions": return [select("moderation","审核状态",{pending:"待审核",accepted:"已接受",rejected:"已拒绝"}),textarea("review_note","审核备注",true)];
  }
}
const defaults:Record<string,string> = { publication:"draft",status:"listed",kind:"official",verified:"0",moderation:"pending",position:"0",claims:"[]",operator_kind:"unknown",lifecycle:"unknown",origin:"editorial" };

export function RecordForm({entity,row}:{entity:Entity;row?:AdminRow}) {
  if (entity==="submissions" && !row) return <p className="plain-empty">从列表选择一条投稿进行审核。</p>;
  return <form action="/api/admin/manage" method="post" className="admin-form">
    <input type="hidden" name="entity" value={entity}/>
    {row && <input type="hidden" name="id" value={String(row.id ?? row.slug)}/>}
    {entity==="sites"&&row&&<p className="wide">官网检查：{reachabilityLabels[row.reachability as keyof typeof reachabilityLabels]} {row.checked_at&&`· ${String(row.checked_at).slice(0,10)}`}</p>}
    {entity==="submissions" && row && <div className="wide"><p><strong>{row.merchant_name||row.kind}</strong> · {row.submitted_at}</p><p>{row.url}</p><div className="editorial-text">{row.body}</div>
      {row.merchant_contact&&<p>联系方式 · {row.merchant_contact}</p>}{row.merchant_offers&&<p>套餐 · {row.merchant_offers}</p>}{row.merchant_operations&&<p>运营说明 · {row.merchant_operations}</p>}</div>}
    {fieldsFor(entity).map(({name,label,type,options,wide,optional,hint})=>{
      const initial = row?.[name] ?? defaults[name] ?? (name.endsWith("_at")&&type==="date"&&!optional?today():"");
      const value = type==="date"?String(initial).slice(0,10):String(initial);
      return <label key={name} className={wide?"wide":undefined}>{label}
        {options?<select name={name} defaultValue={value} required={!optional}><option value="">请选择</option>{Object.entries(options).map(([key,option])=><option key={key} value={key}>{option}</option>)}</select>:
          type==="textarea"?<textarea name={name} defaultValue={value} rows={name==="body"?7:name==="claims"?6:2} required={!optional}/>:
            <input name={name} type={type || "text"} defaultValue={value} required={!optional} readOnly={!!row&&name==="slug"}/>}
        {hint && <small>{hint}</small>}
      </label>;
    })}
    <div className="form-buttons"><button type="submit" name="action" value="save" className="button primary">保存{entity==="submissions"?"审核":""}</button>
      {row&&entity!=="submissions"&&(entity!=="sites"||row.publication==="draft")&&<button type="submit" name="action" value="delete" formNoValidate className="button secondary">删除{entity==="sites"?"草稿":""}</button>}
    </div>
  </form>;
}
