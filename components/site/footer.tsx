import Link from "next/link";
import { Brand } from "./brand";
import { brand } from "@/lib/brand";
import { contentAudience } from "@/lib/geo/request";

export async function Footer() {
  const { label } = await contentAudience();
  return <footer className="site-footer">
    <div className="frame footer-inner">
      <div className="footer-brand"><Brand /><span>© {new Date().getFullYear()} {brand.name}</span></div>
      <nav aria-label="页脚导航">
        <Link href="/about">关于本站</Link>
        <Link href="/contact">联系方式</Link>
        <Link href="/policy">内容政策</Link>
        <Link href="/policy#privacy">隐私说明</Link>
        <Link href="/policy#disclaimer">免责声明</Link>
        <Link href="/contact#cooperation">合作联系</Link>
      </nav>
      <span className="version">当前内容地区：{label} · {brand.version}
        {process.env.GEO_IP_MODE==="nginx-direct"&&<><br/><a href="https://db-ip.com" rel="noreferrer">地区数据由 DB-IP 提供</a></>}
      </span>
    </div>
  </footer>;
}
