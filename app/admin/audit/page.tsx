import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav,requireAdmin } from "@/components/directory/admin";
import { all,directory } from "@/lib/directory/db";
import { param,type Params } from "@/components/directory/catalog-page";

export const dynamic = "force-dynamic";
export const metadata:Metadata = {title:"修改历史",robots:{index:false,follow:false}};
type Audit = { id:number;actor:string;action:string;entity:string;entity_id:string;before_json:string|null;after_json:string|null;created_at:string };
export default async function AuditPage({searchParams}:{searchParams:Promise<Params>}) {
  await requireAdmin();
  const page=Math.min(10000,Math.max(1,Number.parseInt(param((await searchParams).page),10)||1));
  const records=all<Audit>(directory(),"SELECT * FROM audit_log ORDER BY id DESC LIMIT 51 OFFSET ?",(page-1)*50);
  return <div className="frame page admin-page admin-audit"><div className="catalog-heading"><h1>修改历史</h1></div><AdminNav/>
    {records.slice(0,50).map((entry)=><details key={entry.id}><summary><time>{entry.created_at}</time> · {entry.actor} · {entry.action} · {entry.entity} #{entry.entity_id}</summary>
      <strong>变更前</strong><pre>{entry.before_json?JSON.stringify(JSON.parse(entry.before_json),null,2):"无"}</pre>
      <strong>变更后</strong><pre>{entry.after_json?JSON.stringify(JSON.parse(entry.after_json),null,2):"无"}</pre>
    </details>)}
    <div className="pagination">{page>1&&<Link href={`/admin/audit?page=${page-1}`}>上一页</Link>}{records.length>50&&<Link href={`/admin/audit?page=${page+1}`}>下一页</Link>}</div>
  </div>;
}
