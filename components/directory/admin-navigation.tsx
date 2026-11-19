"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const primary=["","sites","submissions","reviews","moderation","traffic"];
const extra=[
  {label:"内容维护",items:["editorials","price_records","sources","categories","incidents"]},
  {label:"导入与采集",items:["imports","discovery","campaigns"]},
  {label:"其他",items:["community","audit"]},
];

export function AdminNavigation({labels}:{labels:Record<string,string>}) {
  const path=usePathname();
  function entry(key:string) {
    const href=key?`/admin/${key}`:"/admin";
    return <Link key={key} href={href} prefetch={false} aria-current={path===href?"page":undefined}>{labels[key]}</Link>;
  }
  return <nav className="admin-nav" aria-label="后台栏目">
    <div className="admin-nav-primary">{primary.map(entry)}</div>
    <details key={path} open={!primary.some(key=>(key?`/admin/${key}`:"/admin")===path)||undefined}>
      <summary>更多管理</summary>
      {extra.map(({label,items})=><div key={label} className="admin-nav-group">
        <span>{label}</span>
        <div>{items.map(entry)}</div>
      </div>)}
    </details>
  </nav>;
}
