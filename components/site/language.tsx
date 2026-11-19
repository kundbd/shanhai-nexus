"use client";

import { Languages } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { clientTranslations } from "@/lib/i18n/client-messages";
import { defaultLanguage, siteLanguages, type SiteLanguage } from "@/lib/i18n/language";

const LanguageContext = createContext<SiteLanguage>(defaultLanguage);

export function SiteLanguageProvider({ language, children }: { language: SiteLanguage; children: ReactNode }) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useSiteLanguage() {
  return useContext(LanguageContext);
}

export function useTranslations() {
  return clientTranslations[useSiteLanguage()];
}

export function LanguageSwitch() {
  const language = useSiteLanguage();
  const t = useTranslations();
  return <form className="language-switch" action="/api/site-language" method="post" aria-label={t("网站语言")}
    onSubmit={(event) => {
      const field = event.currentTarget.elements.namedItem("destination");
      const { pathname, search, hash } = window.location;
      if (field instanceof HTMLInputElement) field.value = pathname + search + hash;
    }}>
    <Languages size={15} aria-hidden="true" />
    <input type="hidden" name="destination" defaultValue="/" />
    {siteLanguages.map(({ code, label }) => (
      <button key={code} type="submit" name="language" value={code} lang={code}
        aria-pressed={language === code} disabled={language === code}>{label}</button>
    ))}
  </form>;
}
