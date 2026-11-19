import Link from "next/link";
import { accountEntryHref } from "@/lib/accounts/paths";
import { discussionHref,threadReplies } from "@/lib/directory/community";
import { reviewMessages } from "@/lib/directory/reviews";
import { siteHref } from "@/lib/directory/types";
import { day } from "./display";
import { ReviewForm } from "./review-form";
import { contentVisibility } from "@/lib/geo/request";

export function ReviewNotice({status}:{status:string}) {
  if (!Object.hasOwn(reviewMessages,status)) return null;
  return <p role={status==="submitted"?"status":"alert"} className={status==="submitted"?"form-notice":"form-error"}>{reviewMessages[status as keyof typeof reviewMessages]}</p>;
}

export function ReplyBox({slug,thread,target,signedIn,returnTo}:{slug:string;thread:number;target:number;signedIn:boolean;returnTo:string}) {
  if (!signedIn) return <Link className="text-link" href={accountEntryHref("login",returnTo)} prefetch={false}>登录后回复</Link>;
  return <details className="reply-box">
    <summary>回复</summary>
    <ReviewForm slug={slug} reply={{thread,target}}/>
  </details>;
}

export function DiscussionShopLink({slug,name}:{slug:string;name:string}) {
  return <Link className="discussion-shop" href={`${siteHref(slug)}#reviews`}><span className="category-tag">店铺</span><span>{name}</span></Link>;
}

export async function DiscussionReplies({thread,slug,rows,shopName,signedIn}:{thread:number;slug:string;rows:ReturnType<typeof threadReplies>;shopName?:string;signedIn:boolean}) {
  if (!rows.length) return null;
  const visibility=await contentVisibility();
  return <ol className="discussion-replies" aria-label="公开回复">{rows.map((reply)=><li key={reply.id} id={`comment-${reply.id}`} className="shop-review discussion-reply">
    {shopName&&<div><DiscussionShopLink slug={slug} name={shopName}/></div>}
    <small>匿名用户 · #{reply.id} · 回复 #{reply.reply_to}{!reply.target_public&&"（原留言已隐藏）"} · {day(reply.submitted_at)}</small>
    <p>{visibility.filterText(reply.body)}</p>
    <ReplyBox slug={slug} thread={thread} target={reply.id} signedIn={signedIn} returnTo={shopName?`${discussionHref(thread)}#thread`:`${siteHref(slug)}#reviews`}/>
  </li>)}</ol>;
}

export function DiscussionLink({thread,count}:{thread:number;count:number}) {
  return <Link className="text-link" href={discussionHref(thread)}>查看讨论（{count} 条回复）</Link>;
}
