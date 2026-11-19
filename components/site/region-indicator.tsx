import { getSiteLanguage, getTranslations } from "@/lib/i18n/server";
import { Globe } from "lucide-react";
import { regionDisplay } from "@/lib/geo/region-display";
import { contentAudience } from "@/lib/geo/request";
import { LanguageSwitch } from "./language";

export async function RegionIndicator() {
  const t = await getTranslations();
  const { country } = await contentAudience();
  const { label, flag } = regionDisplay(country, await getSiteLanguage());
  return <div className="region-strip">
    <div className="frame header-region">
      <span className="current-region">
        {flag ? <span className="region-flag" aria-hidden="true" data-flag={flag.code} style={{ backgroundSize: flag.backgroundSize, backgroundPosition: flag.backgroundPosition }} />
          : <Globe size={15} aria-hidden="true" />}
        <span>{t("当前内容地区：{label}", { label: t(label ?? "其他区域") })}</span>
      </span>
      {process.env.GEO_IP_MODE === "nginx-direct" && <a className="region-data-source" href="https://db-ip.com" rel="noreferrer">{t("地区数据由 DB-IP 提供")}</a>}
      <LanguageSwitch />
    </div>
  </div>;
}
