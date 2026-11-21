export const totpToolPath = "/tools/2fa";
export const totpTitle = "网页版 2FA 生成器";
export const totpDescription = "用 Base32 密钥或 TOTP 设置链接生成动态验证码。";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const hashes = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" } as const;

function decodeBase32(input: string) {
  const value = input.toUpperCase().replace(/[\s-]/g, "");
  const match = /^([A-Z2-7]+)(={0,6})$/.exec(value);
  if (!match) throw new Error("Invalid Base32 secret");
  const [, digits, padding] = match;
  const remainder = digits.length % 8;
  if (![0, 2, 4, 5, 7].includes(remainder) || (padding && padding.length !== (8 - remainder) % 8)) {
    throw new Error("Invalid Base32 length");
  }
  const bytes = [];
  let bits = 0;
  let pending = 0;
  for (const digit of digits) {
    pending = (pending << 5) | alphabet.indexOf(digit);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(pending >> bits);
      pending &= (1 << bits) - 1;
    }
  }
  if (pending !== 0) throw new Error("Invalid Base32 padding");
  return new Uint8Array(bytes);
}

export function parseTotp(input: string) {
  const value = input.trim();
  if (!value || value.length > 2048) throw new Error("Invalid TOTP input");
  let secret = value;
  let algorithm = "SHA1";
  let digits = 6;
  let period = 30;
  if (/^otpauth:/i.test(value)) {
    const uri = new URL(value);
    if (uri.hostname !== "totp" || uri.username || uri.password || uri.port) throw new Error("Invalid TOTP URI");
    const params = uri.searchParams;
    secret = params.get("secret") ?? "";
    algorithm = (params.get("algorithm") ?? "SHA1").toUpperCase();
    digits = Number(params.get("digits") ?? "6");
    const periodValue = params.get("period") ?? "30";
    if (!/^\d+$/.test(periodValue)) throw new Error("Invalid TOTP period");
    period = Number(periodValue);
  }
  if (!Object.hasOwn(hashes, algorithm) || (digits !== 6 && digits !== 8) ||
      period < 1 || !Number.isSafeInteger(period * 1000)) throw new Error("Unsupported TOTP settings");
  return { secret: decodeBase32(secret), hash: hashes[algorithm as keyof typeof hashes], digits, period };
}

export async function totpCode(key: CryptoKey, step: number, digits: number) {
  const counter = new DataView(new ArrayBuffer(8));
  counter.setBigUint64(0, BigInt(step));
  const digest = new DataView(await crypto.subtle.sign("HMAC", key, counter.buffer));
  const offset = digest.getUint8(digest.byteLength - 1) & 15;
  const number = (digest.getUint32(offset) & 0x7fffffff) % (10 ** digits);
  return String(number).padStart(digits, "0");
}
