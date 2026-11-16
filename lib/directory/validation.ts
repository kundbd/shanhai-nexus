import { isIP } from "node:net";
import { parse } from "tldts";

export function websiteUrl(value: string) {
  if (!value || value.length > 1500 || /[\s\\]/.test(value) || value.startsWith("//")) throw new Error("网址格式无效。");
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`); }
  catch { throw new Error("网址无法解析。"); }
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  const domain = host.replace(/^www\./, "");
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port ||
    isIP(host.replace(/^\[|\]$/g, "")) || host.length > 253 || !/^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z](?:[a-z\d-]{0,61}[a-z\d])$/i.test(domain) ||
    /\.(?:local|localhost|internal|invalid|test|example|onion)$/.test(host)) {
    throw new Error("仅接受公开域名的 HTTP 或 HTTPS 网址，且不能包含登录信息或非标准端口。");
  }
  url.hostname = host;
  url.hash = "";
  const parsed = parse(domain,{allowPrivateDomains:true});
  if (!parsed.domain || (!parsed.isIcann && !parsed.isPrivate)) throw new Error("网址需要有效的公开域名后缀。");
  return { url: url.href, domain, registrable:parsed.domain, subdomain:parsed.subdomain || "" };
}

export function textValue(value: unknown, max: number, label: string, required = true) {
  if (typeof value !== "string" && value != null) throw new Error(`${label} 必须为文本。`);
  const text = (value ?? "").trim();
  // Tabs and line endings are allowed in multi-line editorial text.
  // eslint-disable-next-line no-control-regex
  if ((required && !text) || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new Error(`${label} 无效，${required ? "必填，" : ""}最多 ${max} 字。`);
  }
  return text;
}

export function slugValue(value: unknown) {
  const slug = textValue(value, 90, "链接标识");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("链接标识仅允许小写字母、数字和连接号。");
  return slug;
}

export function dateValue(value: unknown, label: string) {
  const date = textValue(value, 10, label);
  const parsed = new Date(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ||
      date > today()) throw new Error(`${label}须为有效日期，且不能晚于当天。`);
  return date;
}

export function choice<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${label}无效。`);
  return value as T;
}

export function recordId(value: unknown) {
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("记录编号无效。");
  return id;
}

export function now() { return new Date().toISOString(); }
const calendar = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
export const today = () => calendar.format(new Date());
