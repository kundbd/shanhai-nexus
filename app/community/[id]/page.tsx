import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentMember } from "@/lib/accounts/current";
import { param,type Params } from "@/components/directory/catalog-page";
import { DiscussionReplies,DiscussionShopLink,ReplyBox,ReviewNotice } from "@/components/directory/discussion";
import { day } from "@/components/directory/display";
import { discussionHref,publicThread,threadReplies } from "@/lib/directory/community";
import { discussionId,reviewPageSize } from "@/lib/directory/reviews";
import { contentVisibility, universalVisibility } from "@/lib/geo/request";

export const dynamic="force-dynamic";
type Props={params:Promise<{id:string}>;searchParams:Promise<Params>};

async function getThread(params:Props["params"]) {
  const id=discussionId((await params).id);
  return id?publicThread(id,undefined,await contentVisibility()):undefined;
}

export async function generateMetadata({params}:Props):Promise<Metadata> {
  const thread=await getThread(params);
  if (!thread) return {robots:{index:false,follow:false}};
  return {title:`${thread.site_name}的公开讨论`,description:`查看关于${thread.site_name}的匿名评价和回复。`,alternates:{canonical:discussionHref(thread.id)},
    ...(!publicThread(thread.id,undefined,universalVisibility())&&{robots:{index:false,follow:false}})};
}

export default async function Thread({params,searchParams}:Props) {
  const thread=await getThread(params);
  if (!thread) notFound();
  const query=await searchParams;
  const signedIn=!!await currentMember();
  const totalPages=Math.max(1,Math.ceil(thread.reply_count/reviewPageSize));
  const page=Math.min(totalPages,Math.max(1,Number.parseInt(param(query.page),10)||1));
  const visibility=await contentVisibility();
  const rows=threadReplies(thread.id,{page},undefined,visibility);
  const href=(next:number)=>`${discussionHref(thread.id)}?page=${next}#replies`;
  return <div className="frame page narrow directory-page community-page">
    <div className="crumbs"><Link href="/community?view=reviews">商家评价</Link></div>
    <header className="catalog-heading"><h1>{thread.site_name}的公开讨论</h1></header>
    <article className="shop-review community-entry" id="thread">
      <h2>商家评价 #{thread.id}</h2>
      <div><DiscussionShopLink slug={thread.slug} name={thread.site_name}/></div>
      <small>匿名用户 · {day(thread.submitted_at)}{thread.score!==null&&` · ${thread.score} / 5`}</small>
      <p>{visibility.filterText(thread.body)}</p>
      <ReviewNotice status={param(query.review)}/>
      <ReplyBox slug={thread.slug} thread={thread.id} target={thread.id} signedIn={signedIn} returnTo={`${discussionHref(thread.id)}#thread`}/>
    </article>
    <section className="community-feed" id="replies">
      <h2>回复（{thread.reply_count}）</h2>
      {rows.length===0&&<p className="plain-empty">暂无公开回复。</p>}
      <DiscussionReplies thread={thread.id} slug={thread.slug} rows={rows} shopName={thread.site_name} signedIn={signedIn}/>
      {totalPages>1&&<nav className="pagination" aria-label="回复分页">
        {page>1&&<Link href={href(page-1)}>上一页</Link>}<span>{page} / {totalPages}</span>{page<totalPages&&<Link href={href(page+1)}>下一页</Link>}
      </nav>}
    </section>
  </div>;
}
