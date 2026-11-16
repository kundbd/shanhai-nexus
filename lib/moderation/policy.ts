export const violationCategories={
  political_advocacy:"涉政讨论、宣传或动员",
  threats:"明确威胁",
  harassment:"定向辱骂或骚扰",
  hate:"仇恨攻击",
  doxxing:"公开他人隐私",
  scam:"诈骗或引流垃圾广告",
  explicit:"露骨色情内容",
} as const;

export type ViolationCategory=keyof typeof violationCategories;
export type ContentSurface="post"|"review";
export type Assessment=
  | {decision:"allow"}
  | {decision:"review"}
  | {decision:"violation";category:ViolationCategory};

export const firstWarning="内容违反社区规则，已移除。本次为首次警告。";
export const repeatedWarning="内容违反社区规则，已移除。账号已禁言 3 天。";
export const mutedWriting="账号当前处于禁言期，暂时无法发帖、转发、回复或提交评价。";
