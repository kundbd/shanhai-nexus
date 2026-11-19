import type { Metadata } from "next";
import Link from "next/link";
import { Notice,requireAdmin } from "@/components/directory/admin";
import { param,type Params } from "@/components/directory/catalog-page";
import { day } from "@/components/directory/display";
import { ReviewWordsEditor } from "@/components/directory/review-words-editor";
import { directory } from "@/lib/directory/db";
import { reviewBlockedWords,reviewModeration,reviewPageSize,reviewQueue,type ReviewModeration } from "@/lib/directory/reviews";
import { matchingReviewWords } from "@/lib/directory/review-word-rules";
import { siteHref } from "@/lib/directory/types";
import { moderationConfig } from "@/lib/moderation/provider";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"评价审核",robots:{index:false,follow:false}};

export default async function ReviewsAdmin({searchParams}:{searchParams:Promise<Params>}) {
  await requireAdmin();
  const input=await searchParams;
  const requested=param(input.state);
  const state=Object.hasOwn(reviewModeration,requested)?requested as ReviewModeration:"pending";
  const page=Math.min(10000,Math.max(1,Number.parseInt(param(input.page),10)||1));
  const db=directory();
  const rows=reviewQueue(db,state,page);
  const words=reviewBlockedWords(db);
  const aiEnabled=moderationConfig().enabled;
  const href=(next:ReviewModeration,number=1)=>`/admin/reviews?${new URLSearchParams({state:next,page:String(number)})}`;
  return <div className="frame page admin-page">
    <div className="catalog-heading"><h1>评价审核</h1></div><Notice input={input}/>
    <nav className="filter-pills" aria-label="评价审核状态">{Object.entries(reviewModeration).map(([key,label])=><Link key={key} href={href(key as ReviewModeration)} aria-current={key===state?"page":undefined}>{label}</Link>)}</nav>
    {!rows.length&&<p className="plain-empty">此状态暂无评价。</p>}
    {rows.slice(0,reviewPageSize).map((row)=>{
      const matches=matchingReviewWords(row.body,words);
      return <article className="admin-import-row shop-review" key={row.id} id={`review-${row.id}`}>
      <h2><Link href={`${siteHref(row.slug)}#reviews`}>{row.site_name}</Link></h2>
      <small>#{row.id} · 匿名用户 · {day(row.submitted_at)}{row.reply_to&&` · 回复 #${row.reply_to}`}{row.score!==null&&` · ${row.score} / 5`}</small>
      {row.body&&<p>{row.body}</p>}
      {!!matches.length&&<p className="form-error">命中屏蔽词 · {matches.map(({word})=>word).join("、")}</p>}
      <div className="admin-action-bar"><form className="form-buttons" action="/api/admin/manage" method="post">
        <input type="hidden" name="action" value="review-moderate"/>
        <input type="hidden" name="id" value={row.id}/>
        <input type="hidden" name="state" value={state}/>
        {state!=="accepted"&&!matches.length&&<button className="button primary" type="submit" name="decision" value="accepted">公开评价</button>}
        {state!=="rejected"&&<button className="button secondary" type="submit" name="decision" value="rejected">拒绝评价</button>}
      </form>
      {aiEnabled&&row.body&&state!=="rejected"&&<form className="form-buttons" action="/api/admin/manage" method="post">
        <input type="hidden" name="id" value={row.id}/><input type="hidden" name="surface" value="review"/>
        <button className="button" name="action" value="ai-moderation-check">DSH 审核</button>
      </form>}</div>
    </article>;})}
    <nav className="pagination" aria-label="审核队列分页">{page>1&&<Link href={href(state,page-1)}>上一页</Link>}{rows.length>reviewPageSize&&<Link href={href(state,page+1)}>下一页</Link>}</nav>
    <details className="admin-fold">
      <summary>评论屏蔽词</summary>
      <div className="admin-fold-body"><ReviewWordsEditor initialWords={words.map(({word})=>word).join("\n")} savedCount={words.length}/></div>
    </details>
  </div>;
}
