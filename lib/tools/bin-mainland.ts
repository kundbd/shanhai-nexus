import mainlandPrefixes from "../../content/bin-mainland-prefixes.json";

const prefixes = new Set(mainlandPrefixes);

export function matchMainlandBin(prefix: string) {
  if (prefix.length === 8 && prefixes.has(prefix)) return { code: "CN", digits: 8 };
  if (prefixes.has(prefix.slice(0, 6))) return { code: "CN", digits: 6 };
}
