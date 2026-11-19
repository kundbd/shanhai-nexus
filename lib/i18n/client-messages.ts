import english from "./messages/client-en.json";
import traditionalChinese from "./messages/client-zh-Hant.json";
import { translator } from "./language";

export const clientMessages = { "zh-CN": {}, "zh-Hant": traditionalChinese, en: english };

export const clientTranslations = {
  "zh-CN": translator(clientMessages["zh-CN"]),
  "zh-Hant": translator(clientMessages["zh-Hant"]),
  en: translator(clientMessages.en),
};
