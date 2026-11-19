import { relayModelBrand } from "./relay-models";

export const codexVerificationProduct="Codex 接码";

export const mentionsCodex=(value:string)=>/\bcodex\b/i.test(value);

export const aiProducts = ["ChatGPT","Claude","Gemini","Grok","DeepSeek","Perplexity","Cursor","Windsurf","Copilot","Suno","Midjourney","Notion AI","Kimi","Qwen","Doubao"] as const;
type AiProduct = typeof aiProducts[number];

const officialProducts: Partial<Record<string, AiProduct>> = {
  chatgpt:"ChatGPT",claude:"Claude",gemini:"Gemini",grok:"Grok",deepseek:"DeepSeek",perplexity:"Perplexity",
};
const productAliases: Partial<Record<AiProduct, RegExp>> = {
  Gemini:/\bgoogle ai (?:plus|pro|ultra)\b/i,Grok:/\bsupergrok\b/i,
};
const productPatterns=aiProducts.map(product=>({product,pattern:new RegExp(`(?:^|[^a-z0-9])${product.toLowerCase()}(?=$|[^a-z0-9])`,"i")}));

export function officialAiProduct(slug: string) {
  return Object.hasOwn(officialProducts,slug)?officialProducts[slug]:undefined;
}

export function mentionedAiProducts(text: string) {
  return productPatterns.filter(({product,pattern})=>productAliases[product]?.test(text)||pattern.test(text)).map(({product})=>product);
}

const smsService = /接[码马]|短信验证|手机(?:号)?验证|\bsms verification\b/i;
const excludedSms = /(?:免|未|无需|不含|不支持|不用)\s*(?:接[码马]|短信验证|手机(?:号)?验证)/gi;
const antigravityCompatibility = /(?:可(?:使)?用|支持|兼容)\s*(?:反重力|antigravity)|(?:反重力|antigravity)\s*(?:可(?:使)?用|支持|兼容)/i;
const offerBrandAliases = [
  ["ChatGPT",/\b(?:open[ -]?ai\b|chat[ -]*g(?:pt|tp)(?=$|[^a-z]|plus|pro)|gpt(?=$|[^a-z])|g[\s.,。_-]*(?:p[\s.,。_-]*t|t[\s.,。_-]*p)(?=\s*(?:plus|pro|go|\d)))/i],
  ["Claude",/克劳德|克洛德/i],
  ["Gemini",/\bgemini(?:pro|ultra|advanced)\b|谷歌\s*ai/i],
  ["Grok",/\b(?:gork|supergrok)(?=$|[^a-z])|\bgrok(?=super|ultra|premium)/i],
  ["DeepSeek",/深度求索|\bdeep[\s_-]+seek\b/i],
  ["Qwen",/通义(?:千问)?|千问/i],
  ["Doubao",/豆包/i],
  ["Kimi",/月之暗面|\bmoonshot\b/i],
  ["Notion AI",/\bnotion\b/i],
  ["Antigravity",/\bantigravity\b|反重力/i],
  ["GitHub Copilot",/\bgithub[ -]+copilot\b/i],
  ["Microsoft Copilot",/\b(?:microsoft|m365|m 365|office 365)[ -]+copilot\b|微软\s*copilot\b/i],
] as const;

export function offerAiBrand(title: string | null, plan: string, category: string, slug: string) {
  if (!category.startsWith("ai-")) return;
  for (const label of new Set([title,plan])) {
    const name=label?.normalize("NFKC").trim();
    if (!name) continue;
    const codex=mentionsCodex(name);
    if (codex && smsService.test(name.replace(excludedSms,""))) return codexVerificationProduct;

    const brands=new Set<string>(mentionedAiProducts(name));
    for (const [brand,pattern] of offerBrandAliases) {
      if (brand==="Antigravity"&&brands.size&&antigravityCompatibility.test(name)) continue;
      if (pattern.test(name)) brands.add(brand);
    }
    if (brands.has("GitHub Copilot")||brands.has("Microsoft Copilot")) brands.delete("Copilot");
    const relayBrand=category==="ai-relay"?relayModelBrand(name):undefined;
    if (relayBrand && relayBrand!=="OpenAI") brands.add(relayBrand);
    if (codex || relayBrand==="OpenAI") brands.add("ChatGPT");
    if (brands.size) return brands.size===1?[...brands][0]:undefined;
  }
  if (category==="ai-subscriptions") return officialAiProduct(slug);
}
