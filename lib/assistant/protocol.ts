export const assistantInputLimit = 500;
export const assistantReplyLimit = 6000;
export const assistantTurnLimit = 6;

export const assistantTools = {
  "/tools/bin-lookup": "银行卡 BIN 地区查询",
  "/tools/2fa": "网页版 2FA 验证码生成器",
  "/tools/us-billing-address": "美区免税州账单地址生成器",
  "/tools/env-check": "出海浏览器环境自检",
  "/tools/fee-calculator": "跨境订阅与 U 卡成本计算器",
  "/tools/account-helper": "本地强密码与注册资料生成器",
} as const;

export function isAssistantTool(path: unknown): path is keyof typeof assistantTools {
  return typeof path === "string" && Object.hasOwn(assistantTools, path);
}

export type AssistantMessage = { role: "user" | "assistant"; content: string };

export async function* readAssistantEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let separator = /\r?\n\r?\n/.exec(buffer);
      while (separator) {
        const event = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, "")).join("\n");
        if (data) yield data;
        separator = /\r?\n\r?\n/.exec(buffer);
      }
      if (buffer.length > 64 * 1024) throw new Error("Assistant event is too large.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
