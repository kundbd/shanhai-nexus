import type { Metadata } from "next";
import Link from "next/link";
import { Notice,requireAdmin } from "@/components/directory/admin";
import { param,type Params } from "@/components/directory/catalog-page";
import { day } from "@/components/directory/display";
import { ReviewWordsEditor } from "@/components/directory/review-words-editor";
import { postHref } from "@/lib/community/limits";
import { communityModeration,feedSize } from "@/lib/community/posts";
import { directory } from "@/lib/directory/db";
import { matchingReviewWords } from "@/lib/directory/review-word-rules";
import { reviewBlockedWords } from "@/lib/directory/reviews";
import { moderationConfig } from "@/lib/moderation/provider";

export const metadata:Metadata={title:"社区帖子管理",robots:{index:false,follow:false}};

export default async function CommunityAdmin({searchParams}:{searchParams:Promise<Params>}) {
  await requireAdmin();
  const input=await searchParams;
  const page=Math.min(10000,Math.max(1,Number.parseInt(param(input.page),10)||1));
  const db=directory();
  const rows=communityModeration(page,db);
  const words=reviewBlockedWords(db);
  const aiEnabled=moderationConfig().enabled;
  return <div className="frame page admin-page">
    <div className="catalog-heading"><h1>已发布帖子</h1></div><Notice input={input}/>
    <details id="blocked-words" className="admin-fold">
      <summary>社区屏蔽词</summary>
      <div className="admin-fold-body"><ReviewWordsEditor initialWords={words.map(({word})=>word).join("\n")} savedCount={words.length} community/></div>
    </details>
    {!rows.length&&<p className="plain-empty">暂无公开帖子。</p>}
    {rows.slice(0,feedSize).map(row=>{
      const matches=row.body?matchingReviewWords(row.body,words):[];
      return <article key={row.id} className="shop-review admin-import-row">
      <h2><Link href={postHref(row.id)}>{row.username} · {row.thread_id?"回复":"帖子"} #{row.id}</Link></h2>
      <small>{day(new Date(row.created_at).toISOString())}{row.media_count>0&&` · ${row.media_count} 个附件`}</small>
      {row.body&&<p>{row.body}</p>}
      {!!matches.length&&<p className="form-error">命中屏蔽词 · {matches.map(({word})=>word).join("、")}</p>}
      <form action="/api/admin/manage" method="post" className="form-buttons">
        <input type="hidden" name="id" value={row.id}/>
        <input type="hidden" name="surface" value="post"/>
        {aiEnabled&&row.body&&<button className="button" name="action" value="ai-moderation-check">DSH 审核</button>}
        <button className="button" name="action" value="community-hide">隐藏帖子</button>
      </form>
    </article>;
    })}
    {(page>1||rows.length>feedSize)&&<nav className="pagination" aria-label="帖子管理分页">
      {page>1&&<Link href={`/admin/community?page=${page-1}`}>上一页</Link>}
      {rows.length>feedSize&&<Link href={`/admin/community?page=${page+1}`}>下一页</Link>}
    </nav>}
  </div>;
}
