import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { param,type Params } from "@/components/directory/catalog-page";
import { DiscussionLink,DiscussionShopLink } from "@/components/directory/discussion";
import { day } from "@/components/directory/display";
import { publicThreads } from "@/lib/directory/community";
import { reviewPageSize } from "@/lib/directory/reviews";
import { PostComposer } from "@/components/community/composer";
import { PostCard } from "@/components/community/post-card";
import { currentMember } from "@/lib/accounts/current";
import { accountEntryHref } from "@/lib/accounts/paths";
import { communityFeed,feedSize } from "@/lib/community/posts";
import { contentVisibility } from "@/lib/geo/request";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"评论社区",description:"浏览山海知序社区帖子和匿名商家评价，分享数字服务的使用体验。",alternates:{canonical:"/community"}};

const views=[{id:"posts",label:"最新帖子"},{id:"reviews",label:"商家评价"},{id:"saved",label:"我的收藏"}] as const;
type View=typeof views[number]["id"];
function pageHref(view:View,page:number) {
  const query=new URLSearchParams();
  if(view!=="posts")query.set("view",view);
  if(page>1)query.set("page",String(page));
  return query.size?`/community?${query}`:"/community";
}

export default async function Community({searchParams}:{searchParams:Promise<Params>}) {
  const params=await searchParams;
  const view=views.find(({id})=>id===param(params.view))?.id??"posts";
  const page=Math.min(10000,Math.max(1,Number.parseInt(param(params.page),10)||1));
  const member=await currentMember(view==="saved");
  if(view==="saved"&&!member)redirect(accountEntryHref("login","/community?view=saved"));
  const login=accountEntryHref("login","/community#compose");
  const posts=view!=="reviews"?communityFeed(page,member?.id,view==="saved"):[];
  return <div className="frame page narrow directory-page community-page">
    <header className="catalog-heading"><h1>评论社区</h1><p>分享数字服务的使用体验，浏览匿名商家评价。</p></header>
    <nav className="filter-pills social-tabs" aria-label="社区栏目">{views.map(({id,label})=><Link key={id} href={pageHref(id,1)}
      prefetch={false} aria-current={view===id?"page":undefined}>{label}</Link>)}</nav>
    {view==="reviews"?<ReviewThreads page={page}/>:<>
      {view==="posts"&&<section id="compose" aria-label="发表帖子">
        {member?<PostComposer username={member.username} loginHref={login}/>:
          <p className="plain-empty boxed-empty"><Link className="text-link" href={login}>登录后发帖</Link>，审核通过后公开。也可以点赞、转发、收藏和回复。</p>}
      </section>}
      <section className="community-feed" aria-label={view==="saved"?"已收藏的帖子":"公开帖子"}>
        {posts.length===0&&<p className="plain-empty boxed-empty">{view==="saved"?"暂无收藏。":"暂无帖子。"}</p>}
        {posts.slice(0,feedSize).map(post=><PostCard key={`${post.id}-${post.reposter_id??0}`} post={post} viewer={member?.id} reposter={post.reposter}/>)}
      </section>
      <CommunityPagination page={page} more={posts.length>feedSize} view={view}/>
    </>}
  </div>;
}

async function ReviewThreads({page}:{page:number}) {
  const visibility=await contentVisibility();
  const threads=publicThreads(page,undefined,visibility);
  return <>
    <Link className="button secondary" href="/services">去商家目录写评价</Link>
    <section className="community-feed" aria-label="公开讨论">
      {threads.length===0&&<p className="plain-empty">暂无已公开的讨论。商家详情里的评论审核通过后会出现在这里。</p>}
      {threads.slice(0,reviewPageSize).map((thread)=><article className="shop-review community-entry" key={thread.id}>
        <h2><DiscussionShopLink slug={thread.slug} name={thread.site_name}/></h2>
        <small>匿名用户 · {day(thread.submitted_at)}{thread.score!==null&&` · ${thread.score} / 5`}</small>
        <p className="discussion-preview">{visibility.filterText(thread.body)}</p>
        <DiscussionLink thread={thread.id} count={thread.reply_count}/>
      </article>)}
    </section>
    <CommunityPagination page={page} more={threads.length>reviewPageSize} view="reviews"/>
  </>;
}

function CommunityPagination({page,more,view}:{page:number;more:boolean;view:View}) {
  if(page===1&&!more)return null;
  return <nav className="pagination" aria-label="社区分页">
    {page>1&&<Link href={pageHref(view,page-1)}>上一页</Link>}
    {more&&<Link href={pageHref(view,page+1)}>下一页</Link>}
  </nav>;
}
