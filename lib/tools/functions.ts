import { translator, type Translate } from "@/lib/i18n/language";
import { format, printParseErrorCode, visit, type ParseError } from "jsonc-parser";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const MAX_TOOL_INPUT = 200_000;

function ensureLength(input: string) {
  if (input.length > MAX_TOOL_INPUT) throw new Error("输入不能超过 200,000 个字符。");
}

const sourceText = translator({});
const jsonErrors: Record<string, string> = {
  InvalidSymbol: "发现无效字符",
  InvalidNumberFormat: "数字格式无效",
  PropertyNameExpected: "需要使用双引号包裹的属性名",
  ValueExpected: "缺少合法的 JSON 值",
  ColonExpected: "缺少冒号",
  CommaExpected: "缺少逗号",
  CloseBraceExpected: "缺少右大括号",
  CloseBracketExpected: "缺少右方括号",
  EndOfFileExpected: "JSON 值后存在多余内容",
  InvalidCommentToken: "JSON 不允许注释",
  UnexpectedEndOfString: "字符串缺少结束引号",
  InvalidEscapeCharacter: "字符串中有无效转义",
  InvalidUnicode: "字符串中有无效 Unicode 转义",
  InvalidCharacter: "字符串中有未转义的控制字符",
};

export function formatJSON(input: string, mode: "pretty" | "minify" | "validate", indent = 2, t: Translate = sourceText): string {
  ensureLength(input);
  if (!input.trim()) throw new Error("请输入要处理的 JSON。");
  // Lexical validation and edits preserve large integers and duplicate keys.
  const errors: ParseError[] = [];
  let depth = 0;
  const begin = () => {
    if (++depth > 128) throw new Error("JSON 嵌套不能超过 128 层。");
  };
  const end = () => { depth--; };
  try {
    visit(input, {
      onObjectBegin: begin, onArrayBegin: begin,
      onObjectEnd: end, onArrayEnd: end,
      onError: (error, offset, length) => errors.push({ error, offset, length }),
    }, { disallowComments: true, allowTrailingComma: false });
  } catch {
    throw new Error("JSON 嵌套过深，请缩小输入范围。");
  }
  if (errors[0]) {
    const { error, offset } = errors[0];
    const lines = input.slice(0, offset).split(/\r\n|\r|\n/);
    throw new Error(t("第 {line} 行，第 {column} 列：{reason}。", { line: lines.length, column: lines.at(-1)!.length + 1, reason: t(jsonErrors[printParseErrorCode(error)] ?? "JSON 语法错误") }));
  }
  // Also enforce the browser's strict JSON grammar.
  try {
    JSON.parse(input);
  } catch {
    throw new Error("JSON 语法无效，请检查数字、空白与分隔符。");
  }
  if (mode === "validate") return t("JSON 语法有效。");
  if (mode === "minify") return input.replace(/"(?:[^"\\]|\\[\s\S])*"|[\t\r\n ]+/g, (piece) => piece.startsWith('"') ? piece : "");
  const edits = format(input, undefined, { tabSize: indent, insertSpaces: true, eol: "\n" });
  const parts: string[] = [];
  let offset = 0;
  for (const edit of edits) {
    parts.push(input.slice(offset, edit.offset), edit.content);
    offset = edit.offset + edit.length;
  }
  const formatted = parts.join("") + input.slice(offset);
  if (formatted.length > MAX_TOOL_INPUT * 5) throw new Error("格式化结果过大，请改用较短的 JSON。");
  return formatted.trim();
}

export function encodeBase64(input: string, urlSafe = false): string {
  ensureLength(input);
  const bytes = new TextEncoder().encode(input);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  const encoded = btoa(chunks.join(""));
  return urlSafe ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : encoded;
}

export function decodeBase64(input: string): string {
  ensureLength(input);
  const compact = input.replace(/[\t\r\n ]/g, "");
  if (/[+/]/.test(compact) && /[-_]/.test(compact)) throw new Error("请使用同一种 Base64 字符集。");
  const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[a-z0-9+/]*={0,2}$/i.test(normalized) || normalized.length % 4 === 1 ||
    (normalized.includes("=") && normalized.length % 4 !== 0)) {
    throw new Error("Base64 格式无效，请检查字符和末尾填充。");
  }
  let binary: string;
  try {
    binary = atob(normalized);
  } catch {
    throw new Error("Base64 格式无效，请检查字符和末尾填充。");
  }
  if (btoa(binary).replace(/=+$/, "") !== normalized.replace(/=+$/, "")) {
    throw new Error("Base64 末尾有无效填充位。");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    throw new Error("解码后的字节无法转换为 UTF-8 文本。");
  }
}

export function fromTimestamp(input: string, unit: "seconds" | "milliseconds"): Date {
  const value = input.trim();
  if (!/^[+-]?\d+(?:\.\d{1,3})?$/.test(value) || value.length > 22 || (unit === "milliseconds" && value.includes("."))) {
    throw new Error("请输入有效的时间戳。秒最多支持三位小数，毫秒须为整数。");
  }
  const [whole, fraction = ""] = value.split(".");
  const millis = unit === "seconds"
    ? BigInt(whole) * 1000n + (value.startsWith("-") ? -1n : 1n) * BigInt(fraction.padEnd(3, "0"))
    : BigInt(whole);
  if (millis > 8640000000000000n || millis < -8640000000000000n) throw new Error("时间戳超出可表示范围。");
  return new Date(Number(millis));
}

export function fromDate(input: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/i.exec(input.trim());
  if (!match) throw new Error("请输入带时区的 ISO 8601 日期，如 2024-01-01T08:00:00+08:00。");
  const [, year, month, day, hour, minute, second = "0", , offsetHour = "0", offsetMinute = "0"] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day) ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      Number(offsetHour) > 23 || Number(offsetMinute) > 59) {
    throw new Error("日期、时间或时区偏移超出有效范围。");
  }
  return new Date(input.trim());
}

export function hashText(input: string, expected = "") {
  ensureLength(input);
  const digest = bytesToHex(sha256(new TextEncoder().encode(input)));
  const comparison = expected.trim().toLowerCase();
  if (comparison && !/^[a-f0-9]{64}$/.test(comparison)) throw new Error("预期摘要必须是 64 位十六进制字符。");
  return { digest, matches: comparison ? comparison === digest : null };
}

export function transformUrl(input: string, mode: "encode" | "decode", form = false): string {
  ensureLength(input);
  try {
    if (mode === "decode") return decodeURIComponent(form ? input.replace(/\+/g, " ") : input);
    const encoded = encodeURIComponent(input);
    return form ? encoded.replace(/%20|[!'()~]/g, (part) =>
      part === "%20" ? "+" : `%${part.charCodeAt(0).toString(16).toUpperCase()}`) : encoded;
  } catch {
    throw new Error(mode === "decode" ? "编码无效，请检查百分号转义和 UTF-8 字节。" : "文本包含无效的 Unicode 字符。");
  }
}
