import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentMember } from "@/lib/accounts/current";
import { accountEntryHref } from "@/lib/accounts/paths";
import { discussionId } from "@/lib/directory/reviews";
import { directory } from "@/lib/directory/db";
import { postHref } from "@/lib/community/limits";
import { communityPost,communityReplies,feedSize } from "@/lib/community/posts";
import { PostCard } from "@/components/community/post-card";
import { PostComposer } from "@/components/community/composer";

export const dynamic="force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {title:t("社区帖子")};
}
type Props={params:Promise<{id:string}>;searchParams:Promise<{page?:string}>};

export default async function CommunityPostPage({params,searchParams}:Props) {
  const t = await getTranslations();
  const id=discussionId((await params).id);
  if(!id)notFound();
  const member=await currentMember();
  const db=directory();
  const post=communityPost(id,member?.id,db);
  if(!post)notFound();
  const query=await searchParams;
  const page=Math.min(10000,Math.max(1,Number.parseInt(query.page??"",10)||1));
  const replies=communityReplies(id,page,member?.id,db,!!post.thread_id);
  const login=accountEntryHref("login",`${postHref(id)}#reply`);
  const pagination=(value:number)=>`${postHref(id)}?page=${value}#replies`;

  return <div className="frame page narrow directory-page community-page">
    <nav className="crumbs" aria-label={t("帖子位置")}><Link href="/community">{t("评论社区")}</Link>
      {post.thread_id&&<Link href={postHref(post.thread_id)}>{t("查看原帖")}</Link>}</nav>
    <h1 className="social-thread-title">{t("帖子")}</h1>
    <PostCard post={post} viewer={member?.id} trackView/>
    <section id="reply" aria-label={t("回复此贴")}>
      {member?<PostComposer username={member.username} replyTo={id} loginHref={login}/>:
        <p className="plain-empty boxed-empty"><Link className="text-link" href={login}>{t("登录后回复")}</Link></p>}
    </section>
    <section id="replies" className="community-feed" aria-labelledby="social-replies">
      <h2 id="social-replies">{t("回复（{count}）", { count: post.replies })}</h2>
      {!replies.length&&<p className="plain-empty">{t("暂无回复。")}</p>}
      {replies.slice(0,feedSize).map(reply=><PostCard key={reply.id} post={reply} viewer={member?.id}/>)}
      {(page>1||replies.length>feedSize)&&<nav className="pagination" aria-label={t("帖子回复分页")}>
        {page>1&&<Link href={pagination(page-1)}>{t("上一页")}</Link>}
        {replies.length>feedSize&&<Link href={pagination(page+1)}>{t("下一页")}</Link>}
      </nav>}
    </section>
  </div>;
}
