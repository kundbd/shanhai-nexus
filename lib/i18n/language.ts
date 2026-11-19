export const siteLanguages = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-Hant", label: "繁體中文" },
  { code: "en", label: "English" },
] as const;

export type SiteLanguage = (typeof siteLanguages)[number]["code"];
export const defaultLanguage: SiteLanguage = "zh-CN";
export const languageCookie = "shanhai-language";

export function isSiteLanguage(value: unknown): value is SiteLanguage {
  return siteLanguages.some(({ code }) => code === value);
}

export type Messages = Readonly<Record<string, string>>;
export type Translate = (source: string, values?: Readonly<Record<string, string | number>>) => string;

export function translator(messages: Messages): Translate {
  return (source, values) => {
    const message = Object.hasOwn(messages, source) ? messages[source] : source;
    return values ? message.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
      Object.hasOwn(values, key) ? String(values[key]) : placeholder) : message;
  };
}
