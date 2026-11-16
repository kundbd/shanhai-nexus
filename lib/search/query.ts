export const MAX_QUERY_LENGTH = 160;

const synonyms = [
  [/pdf\s*(?:转(?:成|换成)?|变(?:成)?|到)\s*(?:word|docx?)/gi, "pdf转word"],
  [/(?:word|docx?)\s*(?:转(?:成|换成)?|变(?:成)?|到)\s*pdf/gi, "word转pdf"],
  [/unix\s*timestamp/gi, "时间戳"],
  [/sha[\s-]?256/gi, "sha256"],
  [/找不到(?:服务器)?ip|域名(?:打不开|不生效|解析不了)|dns解析(?:失败|不了)/gi, "域名解析失败"],
  [/ssh\s*(?:连接(?:失败|不上)|连不上|登不上)/gi, "ssh连接失败"],
] as const;

export function canonicalize(value: string): string {
  let current = value.normalize("NFKC").toLowerCase();
  for (const [pattern, replacement] of synonyms) current = current.replace(pattern, replacement);
  return current;
}

export const compact = (value: string) => value.replace(/[^\p{L}\p{N}]+/gu, "");
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
const ignored = new Set(["如何", "怎么", "怎样", "请问", "一下", "什么", "可以", "需要", "想", "我", "在", "把", "为", "的", "吗", "用", "将", "成", "有", "个", "并", "最", "一个", "一下子", "这个", "问题", "办法", "意思", "是", "尽量", "怎么办"]);
const commonGrams = new Set(["解决", "问题", "教程", "工具", "一般", "可以", "需要", "一下", "什么", "如何", "怎样", "怎么", "办法"]);

export function queryTerms(value: string) {
  const words = new Set<string>();
  const grams = new Set<string>();
  for (const { isWordLike, segment } of segmenter.segment(value)) {
    if (isWordLike && !ignored.has(segment) && Array.from(segment).length >= 2) words.add(segment);
  }
  for (const span of value.match(/\p{Script=Han}+/gu) ?? []) {
    const chars = Array.from(span);
    if (chars.length>=2 && chars.length<=3 && !ignored.has(span) && !commonGrams.has(span) &&
        ![...words].some((word)=>span.includes(word))) words.add(span);
    for (let i = 1; i < chars.length; i++) {
      const gram = chars[i - 1] + chars[i];
      if (!commonGrams.has(gram) && !words.has(gram)) grams.add(gram);
    }
  }
  return { words: [...words], grams: [...grams] };
}
