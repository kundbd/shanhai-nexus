import type { SiteLanguage, Translate } from "@/lib/i18n/language";
import type { ToolId } from "@/lib/catalog/types";
import { decodeBase64, encodeBase64, formatJSON, fromDate, fromTimestamp, hashText, transformUrl } from "./functions";
import { compareText, MAX_DIFF_LENGTH, type DiffBlock } from "./diff";

type Option = { value: string; label: string };
type Mode = Option & { placeholder: string; example: string; action: string; inputLabel: string };
export type WorkspaceResult = { output: string; note?: string; blocks?: readonly DiffBlock[] };
type Workspace = {
  modes: readonly Mode[];
  option?: { label: string; values: readonly Option[]; mode?: string };
  extra?: { label: string; placeholder: string; example?: string; multiline?: boolean };
  limit?: number;
  run(input: string, mode: string, option: string, extra: string, t: Translate, language: SiteLanguage): WorkspaceResult;
};

const jsonExample = '{"project":"Shanhai Nexus","version":"0.2","tools":["JSON","Base64","SHA-256"]}';
const textExample = "你好 🌊";
const isoExample = "2024-01-01T08:00:00+08:00";

export const workspaces: Record<ToolId, Workspace> = {
  json: {
    modes: [
      { value: "pretty", label: "格式化", placeholder: '{ "name": "山海知序" }', example: jsonExample, action: "格式化 JSON", inputLabel: "JSON 输入" },
      { value: "minify", label: "压缩", placeholder: '{ "name": "山海知序" }', example: jsonExample, action: "压缩 JSON", inputLabel: "JSON 输入" },
      { value: "validate", label: "校验", placeholder: '{ "name": "山海知序" }', example: jsonExample, action: "校验 JSON", inputLabel: "JSON 输入" },
    ],
    option: { label: "缩进", mode: "pretty", values: [{ value: "2", label: "2 个空格" }, { value: "4", label: "4 个空格" }] },
    run: (input, mode, indent, _extra, t) => ({ output: formatJSON(input, mode === "minify" || mode === "validate" ? mode : "pretty", Number(indent), t) }),
  },
  base64: {
    modes: [
      { value: "encode", label: "编码", placeholder: "输入 UTF-8 文本", example: textExample, action: "编码为 Base64", inputLabel: "原始文本" },
      { value: "decode", label: "解码", placeholder: "输入 Base64 或 Base64URL", example: "5L2g5aW9IPCfjIo=", action: "解码为文本", inputLabel: "Base64 输入" },
    ],
    option: { mode: "encode", label: "输出格式", values: [{ value: "standard", label: "标准 Base64" }, { value: "url", label: "Base64URL" }] },
    run: (input, mode, option) => ({ output: mode === "decode" ? decodeBase64(input) : encodeBase64(input, option === "url") }),
  },
  timestamp: {
    modes: [
      { value: "timestamp", label: "时间戳 → 日期", placeholder: "例如 1704067200", example: "1704067200", action: "转换为日期", inputLabel: "Unix 时间戳" },
      { value: "date", label: "日期 → 时间戳", placeholder: isoExample, example: isoExample, action: "转换为时间戳", inputLabel: "带时区的日期" },
    ],
    option: { mode: "timestamp", label: "输入单位", values: [{ value: "seconds", label: "秒（s）" }, { value: "milliseconds", label: "毫秒（ms）" }] },
    run: (input, mode, unit, _extra, t, language) => {
      if (mode === "date") {
        const value = fromDate(input).getTime();
        return { output: t("秒（s）：{seconds}\n毫秒（ms）：{milliseconds}", { seconds: value / 1000, milliseconds: value }) };
      }
      const date = fromTimestamp(input, unit === "milliseconds" ? "milliseconds" : "seconds");
      const local = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "long", hour12: false }).format(date);
      return { output: t("UTC：{utc}\n本地：{local}", { utc: date.toISOString(), local }) };
    },
  },
  sha256: {
    modes: [{ value: "digest", label: "SHA-256", placeholder: "输入任意 UTF-8 文本，空文本也可计算", example: "abc", action: "生成 SHA-256", inputLabel: "原始文本" }],
    extra: { label: "预期摘要（可选）", placeholder: "输入 64 位十六进制摘要以比较" },
    run: (input, _mode, _option, extra, t) => {
      const { digest, matches } = hashText(input, extra);
      return { output: digest, note: matches === null ? undefined : t(matches ? "与预期摘要一致。" : "与预期摘要不一致。") };
    },
  },
  url: {
    modes: [
      { value: "encode", label: "编码", placeholder: "粘贴单个网址参数的原文", example: "山海 & 海图 + 1", action: "编码网址参数", inputLabel: "原始文本" },
      { value: "decode", label: "解码", placeholder: "粘贴带百分号的 URL 组件", example: "%E5%B1%B1%E6%B5%B7%20%26%20%E6%B5%B7%E5%9B%BE%20%2B%201", action: "解码网址参数", inputLabel: "已编码的文本" },
    ],
    option: { label: "编码方式", values: [{ value: "component", label: "URL 组件" }, { value: "form", label: "表单格式（空格为 +）" }] },
    run: (input, mode, option) => ({ output: transformUrl(input, mode === "decode" ? "decode" : "encode", option === "form") }),
  },
  diff: {
    modes: [{ value: "lines", label: "逐行对比", placeholder: "粘贴原始版本，最多 2,000 行", example: "标题：海图\n状态：草稿\n作者：小林\n", action: "比较文本", inputLabel: "原始文本" }],
    extra: { label: "修改后文本", placeholder: "粘贴修改后的内容", example: "标题：海图\n状态：发布\n作者：小林\n版本：2\n", multiline: true },
    limit: MAX_DIFF_LENGTH,
    run: (input, _mode, _option, extra, t) => compareText(input, extra, t),
  },
};
