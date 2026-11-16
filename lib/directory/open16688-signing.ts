import { createHmac, randomBytes } from "node:crypto";

type Open16688Value = string | number | boolean | null | readonly Open16688Value[] | { readonly [key: string]: Open16688Value };
type Open16688Params = Readonly<Record<string, Open16688Value>>;
type Credentials = { appId: string; secret: string };

function orderedEntries(data: Open16688Params) {
  return Object.entries(data).sort(([left], [right])=>Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function jsonString(value: string) {
  // The documented PHP flags leave Unicode and slashes intact but escape line separators.
  return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function numberText(value: number) {
  if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
    throw new Error("16688 请求中的大整数须以字符串传入，数值必须有限。");
  }
  return String(value);
}

function sortedJson(value: Open16688Value): string {
  if (typeof value === "string") return jsonString(value);
  if (typeof value === "number") return numberText(value);
  if (value === null || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  return `{${orderedEntries(value as Open16688Params).map(([key, item])=>`${jsonString(key)}:${sortedJson(item)}`).join(",")}}`;
}

export function open16688SigningText(path: string, params: Open16688Params) {
  const route = /^\/openApi\/([a-z][a-z\d]*)\/([a-z][a-z\d]*)$/i.exec(path);
  if (!route) throw new Error("16688 接口路径须包含控制器和动作。");
  const [, controller, action] = route;
  const query = orderedEntries(params).filter(([key])=>key!=="sign").map(([key,value])=>{
    if (value === null) return `${key}=`;
    if (typeof value === "object") return `${key}=${sortedJson(value)}`;
    return `${key}=${typeof value==="number"?numberText(value):String(value)}`;
  }).join("&");
  return ["POST", controller.toLowerCase(), action.toLowerCase(), query].join("\n");
}

export function signedOpen16688Params(path: string, business: Open16688Params, credentials: Credentials, now = Date.now()) {
  if (!credentials.appId.trim() || !credentials.secret.trim()) throw new Error("缺少 16688 应用 ID 或密钥。");
  const timestamp = Math.floor(now / 1000);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error("16688 请求时间无效。");
  for (const field of ["app_id","timestamp","nonce","sign"]) {
    if (Object.hasOwn(business,field)) throw new Error("16688 业务参数不能覆盖认证字段。");
  }
  const params = {...business, app_id:credentials.appId, timestamp:String(timestamp), nonce:randomBytes(16).toString("hex")};
  const sign = createHmac("sha256",credentials.secret).update(open16688SigningText(path,params),"utf8").digest("hex");
  return {...params,sign};
}
