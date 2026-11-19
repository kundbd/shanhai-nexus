import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { accountEntryHref } from "@/lib/accounts/paths";
import { discussionHref,threadReplies } from "@/lib/directory/community";
import { reviewMessages } from "@/lib/directory/reviews";
import { siteHref } from "@/lib/directory/types";
import { day } from "./display";
import { ReviewForm } from "./review-form";
import { contentVisibility } from "@/lib/geo/request";

export async function ReviewNotice({status}:{status:string}) {
  const t = await getTranslations();
  if (!Object.hasOwn(reviewMessages,status)) return null;
  return <p role={status==="submitted"?"status":"alert"} className={status==="submitted"?"form-notice":"form-error"}>{t(reviewMessages[status as keyof typeof reviewMessages])}</p>;
}

export async function ReplyBox({slug,thread,target,signedIn,returnTo}:{slug:string;thread:number;target:number;signedIn:boolean;returnTo:string}) {
  const t = await getTranslations();
  if (!signedIn) return <Link className="text-link" href={accountEntryHref("login",returnTo)} prefetch={false}>{t("登录后回复")}</Link>;
  return <details className="reply-box">
    <summary>{t("回复")}</summary>
    <ReviewForm slug={slug} reply={{thread,target}}/>
  </details>;
}

export async function DiscussionShopLink({slug,name}:{slug:string;name:string}) {
  const t = await getTranslations();
  return <Link className="discussion-shop" href={`${siteHref(slug)}#reviews`}><span className="category-tag">{t("店铺")}</span><span>{name}</span></Link>;
}

export async function DiscussionReplies({thread,slug,rows,shopName,signedIn}:{thread:number;slug:string;rows:ReturnType<typeof threadReplies>;shopName?:string;signedIn:boolean}) {
  const t = await getTranslations();
  if (!rows.length) return null;
  const visibility=await contentVisibility();
  return <ol className="discussion-replies" aria-label={t("公开回复")}>{rows.map((reply)=><li key={reply.id} id={`comment-${reply.id}`} className="shop-review discussion-reply">
    {shopName&&<div><DiscussionShopLink slug={slug} name={shopName}/></div>}
    <small>{t("匿名用户 · #{id}", { id: reply.id })} · {t("回复 #{id}", { id: reply.reply_to })}{!reply.target_public&&t("（原留言已隐藏）")} · {day(reply.submitted_at)}</small>
    <p>{visibility.filterText(reply.body)}</p>
    <ReplyBox slug={slug} thread={thread} target={reply.id} signedIn={signedIn} returnTo={shopName?`${discussionHref(thread)}#thread`:`${siteHref(slug)}#reviews`}/>
  </li>)}</ol>;
}

export async function DiscussionLink({thread,count}:{thread:number;count:number}) {
  const t = await getTranslations();
  return <Link className="text-link" href={discussionHref(thread)}>{t("查看讨论（{count} 条回复）", { count })}</Link>;
}
