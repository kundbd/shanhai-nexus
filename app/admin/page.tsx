import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav,Notice,requireAdmin } from "@/components/directory/admin";
import type { Params } from "@/components/directory/catalog-page";
import { adminOverview } from "@/lib/directory/admin-read";

export const dynamic = "force-dynamic";
export const metadata:Metadata = {title:"编辑后台",robots:{index:false,follow:false}};
export default async function Admin({searchParams}:{searchParams:Promise<Params>}) {
  const actor=await requireAdmin();
  const counts=adminOverview();
  const sections=[
    {title:"待处理",items:[
      {label:"待审核评价与回复",count:counts.reviews,href:"/admin/reviews?state=pending"},
      {label:"待审核投稿",count:counts.submissions,href:"/admin/submissions?state=pending"},
      {label:"待审导入条目",count:counts.imports,href:"/admin/imports"},
    ]},
    {title:"目录概况",items:[
      {label:"公开商家",count:counts.merchants,href:"/admin/sites"},
      {label:"已发布报价记录",count:counts.prices,href:"/admin/price_records"},
      {label:"公开山海观察",count:counts.observations,href:"/admin/editorials"},
      {label:"商家草稿",count:counts.drafts,href:"/admin/sites"},
    ]},
  ];
  return <div className="frame page admin-page">
    <div className="catalog-heading admin-dashboard-heading"><div><h1>编辑后台</h1><p>当前编辑 · {actor}</p></div>
      <form action="/api/admin/session" method="post"><button className="button secondary" name="action" value="logout" type="submit">退出登录</button></form>
    </div>
    <AdminNav/><Notice input={await searchParams}/>
    {sections.map(({title,items})=><section className="admin-overview" key={title}>
      <h2>{title}</h2>
      <ul>{items.map(({label,count,href})=><li key={label}><Link href={href}><strong>{count.toLocaleString("zh-CN")}</strong><span>{label}</span></Link></li>)}</ul>
    </section>)}
  </div>;
}
