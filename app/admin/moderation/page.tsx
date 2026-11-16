import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav,Notice,requireAdmin } from "@/components/directory/admin";
import { param,type Params } from "@/components/directory/catalog-page";
import { directory,one } from "@/lib/directory/db";
import { pendingModeration } from "@/lib/moderation/admin";
import { violationCategories } from "@/lib/moderation/policy";
import { moderationConfig } from "@/lib/moderation/provider";
import { recentPenalties } from "@/lib/moderation/store";

export const metadata:Metadata={title:"DSH 审核",robots:{index:false,follow:false}};
const date=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"short",timeStyle:"short"});

export default async function ModerationAdmin({searchParams}:{searchParams:Promise<Params>}) {
  await requireAdmin();
  const input=await searchParams;
  const page=Math.min(10000,Math.max(1,Number.parseInt(param(input.page),10)||1));
  const db=directory();
  const config=moderationConfig();
  const queue=pendingModeration(db,page);
  const penalties=recentPenalties(db);
  const usage=one<{total:number;failures:number}>(db,`SELECT count(*) total,count(*) FILTER (WHERE status='error') failures
    FROM content_ai_requests WHERE started_at >= ?`,Math.floor(Date.now()/86_400_000)*86_400_000)!;
  return <div className="frame page admin-page">
    <div className="catalog-heading"><h1>DSH 内容审核</h1></div>
    <AdminNav/><Notice input={input}/>
    <p className="section-note">{!config.enabled?"AI 审核未启用。":!config.key?"缺少 DSH 凭证，文字提交会进入人工复核。":`已启用 · ${config.model}`} · UTC 今日请求 {usage.total} 次，失败 {usage.failures} 次。</p>
    <p>确认违规后移除内容。首次警告，第二次起禁言 3 天。模型未能判断的内容由管理员复核。</p>
    <p className="section-note">涉政审核结合正文语境和现行屏蔽词，识别简繁体、拼音、缩写和拆写等变体。<Link className="text-link" href="/admin/community">管理屏蔽词</Link></p>
    <div className="directory-section"><h2>待人工复核</h2></div>
    {!queue.length&&<p className="plain-empty">暂无待复核内容。</p>}
    {queue.slice(0,30).map(item=><article key={`${item.surface}:${item.id}`} className="shop-review admin-import-row">
      <h3>{item.surface==="post"?"社区帖子或回复":"商家评价或回复"} #{item.id}</h3>
      <p>{item.body||"仅含附件"}</p>
      <form className="form-buttons" action="/api/admin/manage" method="post">
        <input type="hidden" name="id" value={item.id}/>
        <input type="hidden" name="surface" value={item.surface}/>
        <input type="hidden" name="scope" value="moderation"/>
        {config.enabled&&item.body&&<button className="button" name="action" value="ai-moderation-check">重新 AI 审核</button>}
        {item.surface==="post"?<>
          <button className="button primary" name="action" value="ai-moderation-approve">公开帖子</button>
          <button className="button" name="action" value="community-hide">隐藏帖子</button>
        </>:null}
      </form>
      {item.surface==="review"&&<form className="form-buttons" action="/api/admin/manage" method="post">
        <input type="hidden" name="id" value={item.id}/>
        <input type="hidden" name="scope" value="moderation"/>
        <input type="hidden" name="state" value="pending"/>
        <input type="hidden" name="action" value="review-moderate"/>
        <button className="button primary" name="decision" value="accepted">公开评价</button>
        <button className="button" name="decision" value="rejected">拒绝评价</button>
      </form>}
    </article>)}
    {(page>1||queue.length>30)&&<nav className="pagination" aria-label="待复核分页">
      {page>1&&<Link href={`/admin/moderation?page=${page-1}`}>上一页</Link>}
      {queue.length>30&&<Link href={`/admin/moderation?page=${page+1}`}>下一页</Link>}
    </nav>}
    <div className="directory-section"><h2>最近处置</h2></div>
    {!penalties.length&&<p className="plain-empty">暂无违规处置记录。</p>}
    {penalties.map(item=><article key={item.id} className="shop-review admin-import-row">
      <h3>{item.username} · 第 {item.strike} 次 · {violationCategories[item.category]}</h3>
      <p>{item.surface==="post"?"社区":"商家评价"} · {date.format(item.created_at)} · {item.muted_until?`禁言至 ${date.format(item.muted_until)}（北京时间）`:"首次警告"}</p>
    </article>)}
  </div>;
}
