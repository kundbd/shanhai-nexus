import Image from "next/image";
import Link from "next/link";
import { Repeat2 } from "lucide-react";
import { accountEntryHref } from "@/lib/accounts/paths";
import { mediaHref,postHref } from "@/lib/community/limits";
import type { CommunityPost } from "@/lib/community/posts";
import { PostActions } from "./post-actions";

const formatDate=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"medium",timeStyle:"short"});

export function PostCard({post,viewer,reposter,trackView}:{post:CommunityPost;viewer?:number;reposter?:string|null;trackView?:boolean}) {
  return <article className="social-card" id={reposter?undefined:`post-${post.id}`}>
    {reposter&&<p className="social-repost"><Repeat2 size={15} aria-hidden="true"/>{reposter} 转发了</p>}
    <header className="social-post-header">
      <span className="social-avatar" aria-hidden="true">{post.username.slice(0,1).toUpperCase()}</span>
      <div><strong>{post.username}</strong> <Link href={postHref(post.id)}>
        <time dateTime={new Date(post.created_at).toISOString()}>{formatDate.format(post.created_at)}</time>
      </Link></div>
    </header>
    {post.reply_to&&<p className="section-note">回复 <Link href={postHref(post.reply_to)} className="text-link">{post.reply_author??`帖子 #${post.reply_to}`}</Link></p>}
    {post.body&&<p className="social-body">{post.body}</p>}
    {!!post.media.length&&<div className={`social-media${post.media.length>1?" social-media-grid":""}`}>
      {post.media.map(({id,mime},index)=>mime.startsWith("video")?
        <video key={id} src={mediaHref(id)} controls playsInline preload="metadata" aria-label={`${post.username} 的视频`}/>:
        <a key={id} href={mediaHref(id)} target="_blank" rel="noreferrer">
          <Image src={mediaHref(id)} width={640} height={440} unoptimized alt={`${post.username} 的照片 ${index+1}`}/>
        </a>)}
    </div>}
    <PostActions id={post.id} initial={{likes:post.likes,reposts:post.reposts,liked:post.liked,reposted:post.reposted,bookmarked:post.bookmarked}} replies={post.replies}
      views={post.views} trackView={trackView} signedIn={viewer!==undefined} owner={viewer===post.author_id} loginHref={accountEntryHref("login",postHref(post.id))}/>
  </article>;
}
