import Link from "next/link";
import type { ReactNode } from "react";
import { currentAdmin } from "@/components/directory/admin";
import { AdminNavigation } from "@/components/directory/admin-navigation";
import { ThemeSwitch } from "@/components/site/theme";
import { brand } from "@/lib/brand";
import { adminLabels } from "@/lib/directory/admin-read";

const labels={...adminLabels,"":"概览",moderation:"社区审核",community:"已发布帖子",visibility:"地区可见性"};

export default async function AdminLayout({children}:{children:ReactNode}) {
  const actor=await currentAdmin();
  return <div className="admin-shell">
    <header className="admin-topbar">
      <div className="frame admin-topbar-inner">
        <Link href="/admin" prefetch={false} className="admin-identity"><strong>{brand.name}</strong><span>管理后台</span></Link>
        <div className="admin-session">
          <Link href="/" prefetch={false}>返回网站</Link>
          <ThemeSwitch />
          {actor&&<form action="/api/admin/session" method="post">
            <button type="submit" name="action" value="logout" className="button secondary">退出登录</button>
          </form>}
        </div>
      </div>
    </header>
    <div className={actor?"frame admin-workspace":"frame admin-sign-in"}>
      {actor&&<AdminNavigation labels={labels}/>}
      <div className="admin-content">{children}</div>
    </div>
  </div>;
}
