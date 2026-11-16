import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentMember } from "@/lib/accounts/current";
import { memberActivity } from "@/lib/accounts/activity";
import { reviewModeration } from "@/lib/directory/reviews";
import { siteHref } from "@/lib/directory/types";
import { day } from "@/components/directory/display";
import { directory } from "@/lib/directory/db";
import { latestPenalty,penaltyActive } from "@/lib/moderation/store";
import { violationCategories } from "@/lib/moderation/policy";

export const metadata:Metadata={title:"个人中心",robots:{index:false,follow:false}};

export default async function Account({searchParams}:{searchParams:Promise<{page?:string|string[]}>}) {
  const member=await currentMember(true);
  if (!member) redirect("/login");
  const {page:requested}=await searchParams;
  const result=memberActivity(member.id,typeof requested==="string"&&/^\d{1,6}$/.test(requested)?Number(requested):1);
  const penalty=latestPenalty(directory(),member.id);

  return <div className="frame page narrow account-page">
    <div className="directory-section">
      <h1>个人中心</h1>
      <form action="/api/account" method="post"><button className="button" name="action" value="logout">退出登录</button></form>
    </div>
    <dl className="fact-grid account-details">
      <div><dt>用户名</dt><dd>{member.username}{member.developer&&<span className="category-tag account-role">开发者</span>}</dd></div>
      <div><dt>注册日期</dt><dd>{day(member.created_at)}</dd></div>
    </dl>
    <p className="account-community"><Link className="text-link" href="/community?view=saved">我的收藏</Link> · <Link className="text-link" href="/community#compose">去社区发帖</Link></p>
    {penalty&&<section className="inline-observation" aria-labelledby="account-penalty">
      <h2 id="account-penalty">社区违规通知</h2>
      <p>{violationCategories[penalty.category]} · 累计 {penalty.strike} 次</p>
      {penalty.strike===1?<p>最近一次违规内容已移除，账号收到警告。</p>:
        <p>{penalty.muted_until&&penaltyActive(penalty)?
          `禁言至 ${new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"medium",timeStyle:"short"}).format(penalty.muted_until)}（北京时间）。`:"最近一次禁言已结束。"}</p>}
      <Link className="text-link" href="/contact">联系站方复核</Link>
    </section>}
    <section aria-labelledby="my-reviews">
      <div className="directory-section"><h2 id="my-reviews">我的评价与回复</h2></div>
      <p className="section-note">{result.totals.total} 条提交 · {result.totals.ratings} 个评分 · {result.totals.replies} 条回复</p>
      {result.rows.length===0?<p className="plain-empty boxed-empty">暂无提交记录。<Link className="text-link" href="/services">查看商家目录</Link></p>:
        <ul className="account-history">{result.rows.map((row)=><li key={row.id} className="inline-observation">
          <h3>{row.published?<Link href={`${siteHref(row.slug)}#reviews`}>{row.name}</Link>:row.name}</h3>
          <p className="section-note">{row.thread_id?"回复":"商家评价"} · {reviewModeration[row.moderation]} · {day(row.submitted_at)}{row.score!==null&&` · ${row.score} / 5`}</p>
          {row.body&&<p>{row.body}</p>}
        </li>)}</ul>}
      {result.pages>1&&<nav className="pagination" aria-label="个人提交记录分页">
        {result.page>1&&<Link href={`/account?page=${result.page-1}`}>上一页</Link>}
        <span>{result.page} / {result.pages}</span>
        {result.page<result.pages&&<Link href={`/account?page=${result.page+1}`}>下一页</Link>}
      </nav>}
    </section>
  </div>;
}
