import Link from "next/link";
import { currentMember } from "@/lib/accounts/current";
import { accountEntryHref } from "@/lib/accounts/paths";
import { directory } from "@/lib/directory/db";
import { publicReviews } from "@/lib/directory/read";
import { reviewPageSize,type ReviewSummary } from "@/lib/directory/reviews";
import { threadReplies } from "@/lib/directory/community";
import { siteHref,type Site } from "@/lib/directory/types";
import { day } from "./display";
import { ReviewForm } from "./review-form";
import { DiscussionLink,DiscussionReplies,ReplyBox,ReviewNotice } from "./discussion";
import { contentVisibility } from "@/lib/geo/request";

export async function ShopReviews({site,page,status,summary}:{site:Site;page:number;status:string;summary:ReviewSummary}) {
  const signedIn=!!await currentMember();
  const visibility=await contentVisibility();
  const totalPages=Math.max(1,Math.ceil(site.review_count/reviewPageSize));
  const current=Math.min(page,totalPages);
  const reviews=publicReviews(site.id,directory(),current);
  const {average,ratings}=summary;
  const returnTo=`${siteHref(site.slug)}#reviews`;
  const pageHref=(number:number)=>`${siteHref(site.slug)}?reviewPage=${number}#reviews`;
  return <section id="reviews">
    <h2>用户评价</h2>
    {site.review_count ? <p className="review-summary"><strong>{average===null?"暂无评分":`${average.toFixed(1)} / 5`}</strong>{ratings>0&&` · ${ratings} 个评分`} · {site.review_count} 条公开评价</p>
      : <p className="plain-empty">暂无评价 · 暂无评分</p>}
    {reviews.map((review)=><article key={review.id} className="inline-observation shop-review">
      <small>匿名用户 · {day(review.submitted_at)}{review.body&&` · #${review.id}`}{review.score!==null&&` · ${review.score} / 5`}{review.evidence_state==="verified"&&" · 证据已核实"}</small>
      {review.body&&<>
        <p>{visibility.filterText(review.body)}</p>
        <div className="discussion-actions"><DiscussionLink thread={review.id} count={review.reply_count}/><ReplyBox slug={site.slug} thread={review.id} target={review.id} signedIn={signedIn} returnTo={returnTo}/></div>
        {review.reply_count>0&&<DiscussionReplies thread={review.id} slug={site.slug} rows={threadReplies(review.id,{preview:true},undefined,visibility)} signedIn={signedIn}/>}
      </>}
    </article>)}
    {totalPages>1&&<nav className="pagination" aria-label="评价分页">
      {current>1&&<Link href={pageHref(current-1)}>上一页</Link>}<span>{current} / {totalPages}</span>{current<totalPages&&<Link href={pageHref(current+1)}>下一页</Link>}
    </nav>}
    <h3 className="review-form-heading">发表评价</h3>
    <ReviewNotice status={status}/>
    {signedIn?<ReviewForm slug={site.slug}/>:<p className="section-note">登录后可以评论和打分。 <Link className="text-link" href={accountEntryHref("login",returnTo)} prefetch={false}>登录后评价</Link> · <Link className="text-link" href={accountEntryHref("register",returnTo)} prefetch={false}>注册账号</Link></p>}
  </section>;
}
