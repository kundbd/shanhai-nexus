import { stat } from "node:fs/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import maxmind, { type CountryResponse, type Reader } from "maxmind";
import { countryCode, makeAudience } from "./policy";

const checkEvery = 60_000;
type CountryDb = { signature: string; reader: Reader<CountryResponse> };
let current: { path: string; checkedAt: number; pending: Promise<CountryDb | undefined> } | undefined;

async function countryDatabase(path: string, previous?: Promise<CountryDb | undefined>) {
  try {
    const file = await stat(path);
    if (!file.isFile() || file.size > 64 * 1024 * 1024) return;
    const signature = `${file.ino}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`;
    const old = await previous;
    return old?.signature === signature ? old : { signature, reader: await maxmind.open<CountryResponse>(path) };
  } catch { return; }
}

export function nginxVisitorAddress(headers: Pick<Headers, "get">) {
  const chain = headers.get("x-forwarded-for");
  const address = chain?.slice(chain.lastIndexOf(",") + 1).trim();
  if (!address || !isIP(address) || address.includes("%")) return;
  const ip = ipaddr.process(address);
  return ip.range() === "unicast" ? ip.toString() : undefined;
}

export async function identifyVisitorCountry(headers: Pick<Headers, "get">) {
  // This mode is for the audited Nginx listener, with a loopback-only Next.js upstream.
  const path = process.env.GEO_IP_DB?.trim();
  if (process.env.NODE_ENV !== "production" || process.env.GEO_IP_MODE !== "nginx-direct" || !path ||
      !["127.0.0.1", "::1"].includes(process.env.HOSTNAME ?? "")) return;
  const ip = nginxVisitorAddress(headers);
  if (!ip) return;
  const now = Date.now();
  if (current?.path !== path || now - current.checkedAt >= checkEvery) {
    const previous = current?.path === path ? current.pending : undefined;
    current = { path, checkedAt: now, pending: countryDatabase(path, previous) };
  }
  try {
    const database = await current.pending;
    return countryCode(database?.reader.get(ip)?.country?.iso_code);
  } catch { return; }
}

export async function identifyAudience(headers: Pick<Headers, "get">) {
  return makeAudience(await identifyVisitorCountry(headers));
}
