export const reviewWordLimit = 200;
export const reviewWordListLength = 12_000;

export const suggestedReviewWords = [
  { label:"辱骂与威胁", words:["傻逼","傻屄","操你妈","操你媽","草你妈","草泥马","滚你妈的","你妈死了","你媽死了","杀你全家","殺你全家"] },
  { label:"人肉与隐私交易", words:["出售个人隐私资料","代查身份证住址","开盒接单","人肉查询接单","出售公民个人信息"] },
  { label:"刷单、诈骗与赌博招揽", words:["刷单返利","刷單返利","刷单兼职日结","代刷信誉日结","博彩送彩金","博彩送彩金","线上博彩开户","線上博彩開戶","稳赚不赔包回本"] },
  { label:"色情与违法交易招揽", words:["上门色情服务","上門色情服務","裸聊加微信","裸聊加微訊","约炮加微信","出售假身份证","出售假身分證"] },
  { label:"垃圾广告与引流", words:["加群领红包","加群領紅包","加微信进福利群","加微信進福利群","私聊领取推广佣金","私聊領取推廣佣金","加群领取免费礼品"] },
  { label:"与商家体验无关的涉政招揽", words:["政治拉票群","时政讨论群","時政討論群","政治动员群","政治動員群","转发政治宣言"] },
] as const;

export type ReviewWord = {word:string; normalized:string};

export function normalizeReviewWords(text:string) {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\p{Cf}\p{P}\p{Z}]+/gu, "");
}

export function parseReviewWords(input:string) {
  if (input.trim().length>reviewWordListLength) throw new Error(`屏蔽词清单最多 ${reviewWordListLength} 字。`);
  const words=new Map<string,ReviewWord>();
  for (const raw of input.split(/\r\n?|\n/)) {
    const word=raw.trim();
    if (!word) continue;
    if (word.length>60) throw new Error("单个屏蔽词最多 60 字。");
    const normalized=normalizeReviewWords(word);
    if (!normalized) throw new Error("屏蔽词须包含文字、数字或符号，不能只有标点或空白。");
    words.set(normalized,{word,normalized});
  }
  if (words.size>reviewWordLimit) throw new Error(`最多可设置 ${reviewWordLimit} 个屏蔽词。`);
  return [...words.values()];
}

export function mergeSuggestedReviewWords(current:readonly ReviewWord[]) {
  const words=new Map(current.map(rule=>[rule.normalized,rule]));
  for (const {words:phrases} of suggestedReviewWords) {
    for (const word of phrases) {
      const normalized=normalizeReviewWords(word);
      if (!words.has(normalized)) words.set(normalized,{word,normalized});
    }
  }
  if (words.size>reviewWordLimit) throw new Error(`合并后超过 ${reviewWordLimit} 个屏蔽词，请先调整清单。`);
  return [...words.values()];
}

export function matchingReviewWords(text:string,words:readonly ReviewWord[]) {
  const normalized=normalizeReviewWords(text);
  return words.filter(word=>normalized.includes(word.normalized));
}
