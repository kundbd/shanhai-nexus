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

export function offerAiBrand(title: string | null, plan: string, category: string, slug: string) {
  if (!category.startsWith("ai-")) return;
  for (const label of new Set([title,plan])) {
    const name=label?.normalize("NFKC").trim();
    if (!name) continue;
    const codex=mentionsCodex(name);
    if (codex && smsService.test(name.replace(excludedSms,""))) return codexVerificationProduct;

    const brands=new Set<string>(mentionedAiProducts(name));
    const relayBrand=category==="ai-relay"?relayModelBrand(name):undefined;
    if (relayBrand && relayBrand!=="OpenAI") brands.add(relayBrand);
    if (codex || relayBrand==="OpenAI" || /\b(?:openai|chat[ -]+gpt|gpt(?=$|[^a-z]))/i.test(name)) brands.add("ChatGPT");
    if (brands.size) return brands.size===1?[...brands][0]:undefined;
  }
  if (category==="ai-subscriptions") return officialAiProduct(slug);
}
