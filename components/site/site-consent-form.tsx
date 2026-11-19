"use client";

import { useTranslations } from "@/components/site/language";

import { useState } from "react";
import { siteConsentAction, siteConsentVersion } from "@/lib/site-consent";

export function SiteConsentForm() {
  const t = useTranslations();
  const [agreement, setAgreement] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  return <form className="site-consent-form" method="post" action={siteConsentAction} onSubmit={(event) => {
    const field = event.currentTarget.elements.namedItem("destination");
    const { pathname, search, hash } = window.location;
    if (field instanceof HTMLInputElement) field.value = pathname + search + hash;
  }}>
    <input type="hidden" name="destination" defaultValue="/" />
    <label>
      <input type="checkbox" name="agreement" required value={siteConsentVersion}
        checked={agreement} onChange={(event) => setAgreement(event.currentTarget.checked)} />
      {t("本人接受本站用户协议")}
    </label>
    <label>
      <input type="checkbox" name="privacy" required value={siteConsentVersion}
        checked={privacy} onChange={(event) => setPrivacy(event.currentTarget.checked)} />
      {t("本人接受本站隐私政策")}
    </label>
    <div className="site-consent-actions">
      <a className="button secondary" href="about:blank">{t("退出网站")}</a>
      <button className="button primary" type="submit" disabled={!agreement || !privacy}>{t("确认并进入")}</button>
    </div>
  </form>;
}
