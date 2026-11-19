import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { recordCoverage } from "./coverage";
import { one,transaction } from "./db";
import { reviewMerchantWithDeepSeek } from "./deepseek-merchant-review";
import { approveItems,getBatch,publishBatch } from "./imports";
import { collectOfficialAvatar,inspectMerchant,saveMerchantAssets,type EnrichmentOptions,type MerchantTarget } from "./merchant-enrichment";
import { storefrontIdentity } from "./storefront-identity";
import { isRetiredCategory,pipelineForCategory } from "./taxonomy";
import { websiteUrl } from "./validation";

const actor="DeepSeek 商家审核";
const leaseMs=150_000;
type ReviewOptions=EnrichmentOptions&{review?:typeof reviewMerchantWithDeepSeek};
type Submission=MerchantTarget&{id:number;token:string;attempts:number};
type Result={submission:number;state:"held"|"retry"|"published";note:string;siteId?:number};
const eligible=`s.kind='site' AND s.publication_consent=1 AND s.merchant_name IS NOT NULL
  AND s.merchant_category IS NOT NULL AND s.url IS NOT NULL AND s.intake_run IS NULL
  AND s.site_id IS NULL AND s.moderation IN ('pending','accepted')`;

function claim(db:DatabaseSync):Submission|undefined {
  return transaction(db,()=>{
    const now=Date.now();
    const row=one<Omit<Submission,"token"|"attempts">>(db,`SELECT s.id,s.merchant_name name,s.url website,s.merchant_category category_slug
      FROM submissions s LEFT JOIN merchant_submission_reviews r ON r.submission_id=s.id
      WHERE ${eligible} AND (r.submission_id IS NULL OR (r.state IN ('checking','retry') AND r.available_at<=?))
      ORDER BY s.id LIMIT 1`,now);
    if (!row) return;
    const token=randomUUID();
    const result=one<{attempts:number}>(db,`INSERT INTO merchant_submission_reviews(submission_id,state,attempts,available_at,token,note,updated_at)
      VALUES (?,'checking',1,?,?,'正在核对公开官网',?) ON CONFLICT(submission_id) DO UPDATE SET state='checking',
      attempts=attempts+1,available_at=excluded.available_at,token=excluded.token,note=excluded.note,updated_at=excluded.updated_at
      RETURNING attempts`,row.id,now+leaseMs,token,new Date(now).toISOString())!;
    return {...row,token,attempts:result.attempts};
  });
}

function finish(db:DatabaseSync,row:Submission,state:Result["state"],note:string,siteId?:number):Result {
  db.prepare(`UPDATE merchant_submission_reviews SET state=?,available_at=?,token=NULL,note=?,updated_at=?
    WHERE submission_id=? AND token=?`)
    .run(state,state==="retry"?Date.now()+row.attempts*300_000:0,note,new Date().toISOString(),row.id,row.token);
  return {submission:row.id,state,note,...(siteId?{siteId}:{})};
}

function registered(db:DatabaseSync,website:string) {
  const storefront=storefrontIdentity(website);
  return !!(storefront?one(db,"SELECT 1 FROM merchant_storefronts WHERE storefront_key=?",storefront.key):
    one(db,"SELECT 1 FROM site_domains WHERE registrable=?",websiteUrl(website).registrable));
}

export async function reviewNextMerchantSubmission(db:DatabaseSync,options:ReviewOptions={}) {
  const review=options.review??reviewMerchantWithDeepSeek;
  if (options.stop?.aborted||(!options.review&&!process.env.DEEPSEEK_API_KEY?.trim())) return;
  const row=claim(db);
  if (!row) return;
  const hold=(note:string)=>finish(db,row,"held",note);
  try {
    const pipeline=pipelineForCategory(row.category_slug);
    if (!pipeline||isRetiredCategory(row.category_slug)) return hold("分类已停止收录或无法匹配。");
    if (registered(db,row.website)) return hold("官网已有档案，避免重复导入。");
    const inspection=await inspectMerchant(db,row,options);
    const evidence=inspection.evidence;
    if (!evidence) return hold("官网身份、相关商品或服务尚缺明确的公开证据。");
    const result=await review({name:row.name,website:evidence.url,category:evidence.category,text:evidence.text},options.stop);
    if (result.decision!=="approve") return hold("DeepSeek 无法依据公开页面确认此投稿，待人工复核。");
    const avatar=await collectOfficialAvatar(db,row,inspection,options);
    options.stop?.throwIfAborted();
    return transaction(db,()=>{
      const current=one(db,`SELECT 1 FROM submissions s JOIN merchant_submission_reviews r ON r.submission_id=s.id
        WHERE ${eligible} AND s.id=? AND s.url=? AND s.merchant_name=? AND s.merchant_category=? AND r.token=?`,
      row.id,row.website,row.name,row.category_slug,row.token);
      if (!current) return hold("投稿已由其他审核流程处理。");
      if (registered(db,row.website)) return hold("官网已有档案，避免重复导入。");
      const stamp=new Date().toISOString();
      const run=recordCoverage(db,{
        pipeline,access:"submission",source_name:`授权商家投稿 #${row.id} · DeepSeek`,
        source_url:evidence.url,evidence_url:evidence.url,reason:"投稿人同意公开资料。DeepSeek 依据商家公开页面核对店铺及服务。",
      },JSON.stringify([{
        url:row.website,name:row.name,category:evidence.category,source_url:evidence.url,
        source_title:"商家公开官网",snapshot_at:stamp.slice(0,10),
      }]),"json",actor,true);
      const batch=run.batch_id!;
      const [candidate]=getBatch(batch,db);
      if (!candidate||candidate.state!=="ready") throw new Error("商家候选资料未就绪");
      db.prepare("UPDATE import_items SET checked_at=?,reachability='reachable',check_detail=?,final_url=? WHERE id=?")
        .run(stamp,result.evidence,evidence.url,candidate.id);
      if (approveItems(db,batch,[candidate.id],actor,true).count!==1||publishBatch(db,batch,actor,[candidate.id],true)!==1) {
        throw new Error("商家候选没通过导入校验");
      }
      const saved=one<{site_id:number}>(db,"SELECT site_id FROM import_items WHERE id=? AND state='published'",candidate.id)!;
      const assets=saveMerchantAssets(db,{...row,id:saved.site_id,category_slug:evidence.category},inspection,avatar,stamp,actor);
      db.prepare("UPDATE submissions SET intake_run=?,site_id=?,moderation='accepted' WHERE id=?").run(run.id,saved.site_id,row.id);
      const note=`已自动发布。公开报价 ${assets.checked} 项。店铺图标${assets.hasAvatar?"已收录":"暂缺公开来源"}。`;
      return finish(db,row,"published",note,saved.site_id);
    });
  } catch (error) {
    const provider=error instanceof Error&&/^DeepSeek 商家审核 HTTP \d{3}$/.test(error.message)?error.message:"公开页面、DeepSeek 或导入校验暂未完成";
    if (options.stop?.aborted) return finish(db,row,"retry","服务重启后会继续核对。");
    if (row.attempts>=3) return hold(`${provider}。请在现有后台复核。`);
    return finish(db,row,"retry",`${provider}。稍后重试。`);
  }
}
