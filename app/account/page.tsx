import { getSiteLanguage, getTranslations } from "@/lib/i18n/server";
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
import { contentVisibility } from "@/lib/geo/request";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {title:t("个人中心"),robots:{index:false,follow:false}};
}

export default async function Account({searchParams}:{searchParams:Promise<{page?:string|string[]}>}) {
  const t = await getTranslations();
  const member=await currentMember(true);
  if (!member) redirect("/login");
  const {page:requested}=await searchParams;
  const visibility=await contentVisibility();
  const result=memberActivity(member.id,typeof requested==="string"&&/^\d{1,6}$/.test(requested)?Number(requested):1,undefined,visibility);
  const penalty=latestPenalty(directory(),member.id);

  return <div className="frame page narrow account-page">
    <div className="directory-section">
      <h1>{t("个人中心")}</h1>
      <form action="/api/account" method="post"><button className="button" name="action" value="logout">{t("退出登录")}</button></form>
    </div>
    <dl className="fact-grid account-details">
      <div><dt>{t("用户名")}</dt><dd>{member.username}{member.developer&&<span className="category-tag account-role">{t("开发者")}</span>}</dd></div>
      <div><dt>{t("注册日期")}</dt><dd>{day(member.created_at)}</dd></div>
    </dl>
    <p className="account-community"><Link className="text-link" href="/community?view=saved">{t("我的收藏")}</Link> · <Link className="text-link" href="/community#compose">{t("去社区发帖")}</Link></p>
    {penalty&&<section className="inline-observation" aria-labelledby="account-penalty">
      <h2 id="account-penalty">{t("社区违规通知")}</h2>
      <p>{t(violationCategories[penalty.category])} {t("· 累计 {count} 次", { count: penalty.strike })}</p>
      {penalty.strike===1?<p>{t("最近一次违规内容已移除，账号收到警告。")}</p>:
        <p>{penalty.muted_until&&penaltyActive(penalty)?
          t("禁言至 {date}（北京时间）。", { date: new Intl.DateTimeFormat(await getSiteLanguage(), { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(penalty.muted_until) }):t("最近一次禁言已结束。")}</p>}
      <Link className="text-link" href="/contact">{t("联系站方复核")}</Link>
    </section>}
    <section aria-labelledby="my-reviews">
      <div className="directory-section"><h2 id="my-reviews">{t("我的评价与回复")}</h2></div>
      <p className="section-note">{t("{reviews} 条提交 · {ratings} 个评分 · {replies} 条回复", { reviews: result.totals.total, ratings: result.totals.ratings, replies: result.totals.replies })}</p>
      {result.rows.length===0?<p className="plain-empty boxed-empty">{t("暂无提交记录。")}<Link className="text-link" href="/services">{t("查看商家目录")}</Link></p>:
        <ul className="account-history">{result.rows.map((row)=><li key={row.id} className="inline-observation">
          <h3>{row.published?<Link href={`${siteHref(row.slug)}#reviews`}>{row.name}</Link>:row.name}</h3>
          <p className="section-note">{row.thread_id?t("回复"):t("商家评价")} · {t(reviewModeration[row.moderation])} · {day(row.submitted_at)}{row.score!==null&&` · ${row.score} / 5`}</p>
          {row.body&&<p>{visibility.filterText(row.body)}</p>}
        </li>)}</ul>}
      {result.pages>1&&<nav className="pagination" aria-label={t("个人提交记录分页")}>
        {result.page>1&&<Link href={`/account?page=${result.page-1}`}>{t("上一页")}</Link>}
        <span>{result.page} / {result.pages}</span>
        {result.page<result.pages&&<Link href={`/account?page=${result.page+1}`}>{t("下一页")}</Link>}
      </nav>}
    </section>
  </div>;
}
