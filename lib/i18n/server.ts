import { cookies } from "next/headers";
import { cache } from "react";
import { clientMessages } from "./client-messages";
import { defaultLanguage, isSiteLanguage, languageCookie, translator } from "./language";
import english from "./messages/en.json";
import traditionalChinese from "./messages/zh-Hant.json";

const translations = {
  "zh-CN": translator({}),
  "zh-Hant": translator({ ...clientMessages["zh-Hant"], ...traditionalChinese }),
  en: translator({ ...clientMessages.en, ...english }),
};

export const getSiteLanguage = cache(async () => {
  const language = (await cookies()).get(languageCookie)?.value;
  return isSiteLanguage(language) ? language : defaultLanguage;
});

export async function getTranslations() {
  return translations[await getSiteLanguage()];
}
