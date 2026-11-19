import { getSiteLanguage, getTranslations } from "@/lib/i18n/server";
import Image from "next/image";
import Link from "next/link";
import { Repeat2 } from "lucide-react";
import { accountEntryHref } from "@/lib/accounts/paths";
import { mediaHref,postHref } from "@/lib/community/limits";
import type { CommunityPost } from "@/lib/community/posts";
import { PostActions } from "./post-actions";

export async function PostCard({post,viewer,reposter,trackView}:{post:CommunityPost;viewer?:number;reposter?:string|null;trackView?:boolean}) {
  const t = await getTranslations();
  const formatDate = new Intl.DateTimeFormat(await getSiteLanguage(), { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" });
  return <article className="social-card" id={reposter?undefined:`post-${post.id}`}>
    {reposter&&<p className="social-repost"><Repeat2 size={15} aria-hidden="true"/>{reposter}{" "}{t("转发了")}</p>}
    <header className="social-post-header">
      <span className="social-avatar" aria-hidden="true">{post.username.slice(0,1).toUpperCase()}</span>
      <div><strong>{post.username}</strong> <Link href={postHref(post.id)}>
        <time dateTime={new Date(post.created_at).toISOString()}>{formatDate.format(post.created_at)}</time>
      </Link></div>
    </header>
    {post.reply_to&&<p className="section-note">{t("回复")}{" "}<Link href={postHref(post.reply_to)} className="text-link">{post.reply_author?? t("帖子 #{id}", { id: post.reply_to })}</Link></p>}
    {post.body&&<p className="social-body">{post.body}</p>}
    {!!post.media.length&&<div className={`social-media${post.media.length>1?" social-media-grid":""}`}>
      {post.media.map(({id,mime},index)=>mime.startsWith("video")?
        <video key={id} src={mediaHref(id)} controls playsInline preload="metadata" aria-label={t("{username} 的视频", { username: post.username })}/>:
        <a key={id} href={mediaHref(id)} target="_blank" rel="noreferrer">
          <Image src={mediaHref(id)} width={640} height={440} unoptimized alt={t("{username} 的照片 {index}", { username: post.username, index: index + 1 })}/>
        </a>)}
    </div>}
    <PostActions id={post.id} initial={{likes:post.likes,reposts:post.reposts,liked:post.liked,reposted:post.reposted,bookmarked:post.bookmarked}} replies={post.replies}
      visitors={post.visitors} trackView={trackView} signedIn={viewer!==undefined} owner={viewer===post.author_id} loginHref={accountEntryHref("login",postHref(post.id))}/>
  </article>;
}
