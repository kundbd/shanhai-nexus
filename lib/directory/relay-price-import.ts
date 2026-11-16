import type { DatabaseSync } from "node:sqlite";
import { all,one,transaction } from "./db";
import { relayRateRegion,relayTokenPeriods } from "./relay-quote-units";
import { dateValue,now,slugValue,websiteUrl } from "./validation";
import { audit,writeEntityInTransaction } from "./write";
import { pipelineForCategory } from "./taxonomy";

type Money="USD"|"CNY"|"EUR"|"GBP";
type Source={url:string; note:string; rates?:readonly (readonly [model:string,currency:Money,input:string,output:string])[];
  plans?:readonly (readonly [name:string,currency:Money,amount:string,period?:string,region?:string])[]};
type Profile={name:string;slug:string;website:string;summary:string;category?:string;sources:readonly Source[]};
type Batch={observed:string;merchants:readonly Profile[]};
const actor="editor:public-service-pages";
const amountScale=6;

function scaled(amount:string) {
  if (!/^\d{1,5}(?:\.\d{1,6})?$/.test(amount)) throw new Error("模型报价的小数格式无效。");
  const [whole,fraction=""]=amount.split(".");
  return Number(whole+fraction.padEnd(amountScale,"0"));
}

export function importRelayPricing(db:DatabaseSync,batch:Batch) {
  const day=dateValue(batch.observed,"报价观察日期");
  return transaction(db,()=>{
    const result={added:0,reclassified:0,existing:0,priced:0,quotes:0,skipped:[] as string[]};
    for(const profile of batch.merchants) {
      const website=websiteUrl(profile.website);
      const category=slugValue(profile.category??"ai-relay");
      if (!pipelineForCategory(category)) throw new Error(`${profile.name} 的服务分类不受支持。`);
      if (!profile.sources.length) throw new Error(`${profile.name} 缺少来源。`);
      const matches=all<{id:number;category_slug:string;status:string;publication:string;lifecycle:string;operator_kind:string}>(db,`SELECT DISTINCT s.id,s.category_slug,s.status,s.publication,s.lifecycle,s.operator_kind
        FROM sites s JOIN site_domains d ON d.site_id=s.id WHERE d.registrable=?`,website.registrable);
      const existing=matches[0];
      const mayReclassify=category==="ai-relay"&&existing?.category_slug==="ai-platforms"&&existing.operator_kind!=="official";
      if (matches.length>1 || (existing && (existing.publication!=="published" || existing.lifecycle==="closed" ||
          (!mayReclassify&&existing.category_slug!==category)))) {
        result.skipped.push(profile.name);continue;
      }
      const site=existing?.id??Number(writeEntityInTransaction(db,"sites",{
        slug:profile.slug,name:profile.name,website:website.url,summary:profile.summary,category_slug:category,
        operator_kind:"third_party",status:"listed",publication:"published",
      },actor));
      if (!existing) result.added++;
      else if(existing.category_slug===category) result.existing++;
      else result.reclassified++;
      let priced=false;
      const quoteCount=result.quotes;
      for (const source of profile.sources) {
        const link=websiteUrl(source.url);
        if (link.registrable!==website.registrable) throw new Error(`${profile.name} 的报价来源域名不匹配。`);
        const rates=source.rates??[];
        const plans=source.plans??[];
        if (rates.length&&category!=="ai-relay") throw new Error(`${profile.name} 的 Token 报价必须归入 AI 中转。`);
        const notes=[source.note,...rates.map(([model,currency,input,output])=>`${model} ${currency} ${input} 输入 / ${output} 输出，每百万 Token`),...plans.map(([name,currency,value,period="月付"])=>`${name} ${currency} ${value} · ${period}`)];
        const known=one<{id:number}>(db,"SELECT id FROM sources WHERE site_id=? AND url=? AND accessed_at=? AND kind='official' AND verified=1",site,link.url,day);
        const sourceId=known?.id??Number(writeEntityInTransaction(db,"sources",{
          site_id:site,title:`${profile.name} ${rates.length||plans.length?"公开价目":"公开资料"}`,url:link.url,accessed_at:day,
          kind:"official",verified:"1",excerpt:notes.join("\n"),attribution:profile.name,
        },actor));
        const rows=[...rates.flatMap(([model,currency,input,output])=>relayTokenPeriods.map((period,i)=>({plan:model,currency,period,amount:i===0?input:output,region:relayRateRegion}))),
          ...plans.map(([plan,currency,amount,period="月付",region="官网报价"])=>({plan,currency,amount,period,region}))];
        priced ||= rows.length>0;
        for(const quote of rows) {
          const amount=scaled(quote.amount);
          const old=one<{amount_minor:number;amount_scale:number|null}>(db,`SELECT amount_minor,amount_scale FROM price_records
            WHERE site_id=? AND plan=? AND currency=? AND period=? AND region=? AND recorded_at=? AND storefront_observed=0`,
            site,quote.plan,quote.currency,quote.period,quote.region,day);
          if (old) {
            if (old.amount_minor!==amount||old.amount_scale!==amountScale) throw new Error(`${profile.name} ${quote.plan} 同日已有不同报价。`);
            continue;
          }
          writeEntityInTransaction(db,"price_records",{
            site_id:site,source_id:sourceId,plan:quote.plan,currency:quote.currency,period:quote.period,region:quote.region,
            amount_minor:String(amount),amount_scale:amountScale,notes:source.note,recorded_at:day,publication:"published",
          },actor);
          result.quotes++;
        }
      }
      if (priced) result.priced++;
      if (mayReclassify || result.quotes>quoteCount) {
        db.prepare(`UPDATE sites SET category_slug=?,updated_at=? WHERE id=?`).run(category,now(),site);
        if(mayReclassify) audit(db,actor,"catalog_recategorized","sites",site,existing,{category_slug:category});
      }
    }
    return result;
  });
}
