import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sessionCookie = "shanhai_admin";
export const sessionSeconds = 8 * 60 * 60;
const attempts = globalThis as typeof globalThis & { shanhaiAttempts?: { until: number; count: number } };
function config() {
  const user = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!user || user.length > 80 || !password || password.length < 16 || !secret || secret.length < 32 || secret === password) return undefined;
  return { user, password, secret };
}
const hash = (value: string) => createHash("sha256").update(value).digest();
function sign(value: string, secret: string) { return createHmac("sha256",secret).update(value).digest("base64url"); }

export function adminEnabled() { return !!config(); }
export function mutationOrigin(request: Request) {
  const configured = process.env.ADMIN_ORIGIN;
  const incoming = request.headers.get("origin");
  if (!incoming) return false;
  if (configured) {
    try { return incoming === new URL(configured).origin; }
    catch { return false; }
  }
  const target = new URL(request.url);
  return ["localhost","127.0.0.1","[::1]"].includes(target.hostname) && incoming === target.origin;
}
export function secureCookie(request: Request) {
  return new URL(process.env.ADMIN_ORIGIN || request.url).protocol === "https:";
}
export function login(user: string, password: string) {
  const credentials = config();
  if (!credentials || user.length > 80 || password.length > 400) return undefined;
  const time = Date.now();
  const limit = attempts.shanhaiAttempts ??= { until:time + 900_000,count:0 };
  if (time >= limit.until) Object.assign(limit,{until:time+900_000,count:0});
  if (limit.count >= 15) return undefined;
  const validUser = timingSafeEqual(hash(user),hash(credentials.user));
  const validPassword = timingSafeEqual(hash(password),hash(credentials.password));
  if (!validUser || !validPassword) { limit.count++; return undefined; }
  return issueToken(credentials,time);
}
function sessionSignature(value: string, credentials: NonNullable<ReturnType<typeof config>>) {
  return sign(value + "\n" + credentials.user + "\n" + hash(credentials.password).toString("hex"),credentials.secret);
}
function issueToken(credentials: NonNullable<ReturnType<typeof config>>, time: number) {
  const token = `${Math.floor(time/1000)+sessionSeconds}.${randomBytes(18).toString("base64url")}`;
  return `${token}.${sessionSignature(token,credentials)}`;
}
export function adminActor(token?: string) {
  const credentials = config();
  if (!credentials || !token || !/^\d{10,12}\.[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const [expires,nonce,signature] = token.split(".");
  if (Number(expires) <= Date.now()/1000) return undefined;
  return timingSafeEqual(Buffer.from(signature),Buffer.from(sessionSignature(`${expires}.${nonce}`,credentials))) ? credentials.user : undefined;
}
