import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { Brand } from "./brand";
import { brand } from "@/lib/brand";

export async function Footer() {
  const t = await getTranslations();
  return <footer className="site-footer">
    <div className="frame footer-inner">
      <div className="footer-brand"><Brand homeLabel={t("首页")} /><span>© {new Date().getFullYear()} {brand.name}</span></div>
      <nav aria-label={t("页脚导航")}>
        <Link href="/about">{t("关于本站")}</Link>
        <Link href="/contact">{t("联系方式")}</Link>
        <Link href="/policy">{t("内容政策")}</Link>
        <Link href="/policy#privacy">{t("隐私政策")}</Link>
        <Link href="/policy#disclaimer">{t("免责声明")}</Link>
        <Link href="/contact#cooperation">{t("合作联系")}</Link>
      </nav>
      <span className="version">{brand.version}</span>
    </div>
  </footer>;
}
