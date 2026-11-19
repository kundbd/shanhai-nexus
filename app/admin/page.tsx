import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Notice,requireAdmin } from "@/components/directory/admin";
import type { Params } from "@/components/directory/catalog-page";
import { adminOverview } from "@/lib/directory/admin-read";

export const dynamic = "force-dynamic";
export const metadata:Metadata = {title:"编辑后台",robots:{index:false,follow:false}};
export default async function Admin({searchParams}:{searchParams:Promise<Params>}) {
  await requireAdmin();
  const counts=adminOverview();
  const pending=[
    {label:"待审核投稿",count:counts.submissions,href:"/admin/submissions?state=pending"},
    {label:"待审核评价",count:counts.reviews,href:"/admin/reviews?state=pending"},
    {label:"待审核帖子",count:counts.posts,href:"/admin/moderation"},
    {label:"待审核导入",count:counts.imports,href:"/admin/imports"},
  ];
  const catalog=[
    {label:"公开商家",count:counts.merchants,href:"/admin/sites"},
    {label:"已发布报价",count:counts.prices,href:"/admin/price_records"},
    {label:"公开山海观察",count:counts.observations,href:"/admin/editorials"},
  ];
  return <div className="frame page admin-page">
    <div className="catalog-heading"><h1>概览</h1></div>
    <Notice input={await searchParams}/>
    <section className="admin-overview admin-queue">
      <h2>待处理</h2>
      <ul>{pending.map(({label,count,href})=><li key={label}><Link href={href} prefetch={false}>
        <span>{label}</span><strong>{count.toLocaleString("zh-CN")}</strong><ArrowRight size={16} aria-hidden="true"/>
      </Link></li>)}</ul>
    </section>
    <section className="admin-overview">
      <h2>目录概况</h2>
      <ul>{catalog.map(({label,count,href})=><li key={label}><Link href={href} prefetch={false}>
        <strong>{count.toLocaleString("zh-CN")}</strong><span>{label}</span>
      </Link></li>)}</ul>
    </section>
  </div>;
}
