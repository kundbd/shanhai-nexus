import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav,requireAdmin } from "@/components/directory/admin";
import { directory } from "@/lib/directory/db";
import { trafficReport } from "@/lib/directory/traffic";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"访问统计",robots:{index:false,follow:false}};

const number=new Intl.NumberFormat("zh-CN");
const percent=new Intl.NumberFormat("zh-CN",{style:"percent",maximumFractionDigits:1});
const timestamp=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"short",timeStyle:"short"});

export default async function TrafficAdmin() {
  await requireAdmin();
  const {asOf,total,pages}=trafficReport(directory());
  return <div className="frame page admin-page">
    <div className="catalog-heading admin-dashboard-heading"><div><h1>访问统计</h1><p>截至北京时间 {timestamp.format(asOf)}</p></div>
      <form action="/admin/traffic" method="get"><button className="button secondary" type="submit">刷新数据</button></form>
    </div>
    <AdminNav/>
    <section className="traffic-summary" aria-labelledby="traffic-total-label">
      <h2 id="traffic-total-label">最近 24 小时浏览人数</h2>
      <strong data-traffic-total={total}>{number.format(total)}</strong>
      <p className="section-note">按浏览器去重。全站和各页面分别统计，同一访客可以浏览多个页面。</p>
    </section>
    <section className="admin-overview" aria-labelledby="traffic-popular-label">
      <h2 id="traffic-popular-label">热门页面</h2>
      {pages.length===0?<p className="plain-empty boxed-empty">最近 24 小时暂无浏览记录。</p>:<table className="traffic-table" aria-labelledby="traffic-popular-label">
        <thead><tr><th scope="col">页面</th><th scope="col">浏览人数</th><th scope="col">占全站访客</th></tr></thead>
        <tbody>{pages.map(({page,visitors,title})=><tr key={page}>
          <th scope="row">{title?<><Link href={page}>{title}</Link><small>{page}</small></>:page}</th>
          <td>{number.format(visitors)}</td><td>{percent.format(visitors/total)}</td>
        </tr>)}</tbody>
      </table>}
    </section>
  </div>;
}
