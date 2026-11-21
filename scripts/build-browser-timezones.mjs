import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// https://data.iana.org/time-zones/releases/tzdata2026f.tar.gz (public domain).
const [source] = process.argv.slice(2);
if (!source) throw new Error("Usage: node scripts/build-browser-timezones.mjs TZDATA_DIR");
const lines = file => readFileSync(join(source, file), "utf8").split(/\r?\n/);
const zones = new Map();
for (const file of ["zone.tab", "zone1970.tab"]) {
  for (const line of lines(file).filter(line => line && !line.startsWith("#"))) {
    const [regions, , zone] = line.split("\t");
    if (!zone || !/^[A-Z]{2}(?:,[A-Z]{2})*$/.test(regions)) throw new Error("Unexpected tzdata row");
    zones.set(zone, [...new Set([...(zones.get(zone) ?? []), ...regions.split(",")])].sort());
  }
}

const links = new Map(lines("backward").filter(line => /^Link\s/.test(line)).map(line => {
  const [, target, alias] = line.split(/\s+/);
  return [alias, target];
}));
for (const [alias, target] of links) {
  if (zones.has(alias)) continue;
  let current = target;
  const visited = new Set();
  while (!zones.has(current) && links.has(current) && !visited.has(current)) {
    visited.add(current);
    current = links.get(current);
  }
  if (zones.has(current)) zones.set(alias, zones.get(current));
}
if (!zones.get("Asia/Shanghai")?.includes("CN") || !zones.get("US/Eastern")?.includes("US")) {
  throw new Error("Incomplete tzdata mapping");
}
const entries = [...zones].map(([zone, countries]) => [zone.toLowerCase(), countries.join(",")]);
const version = lines("version")[0];
writeFileSync("content/browser-timezone-regions.json", `${JSON.stringify({ version, zones: Object.fromEntries(entries.sort()) })}\n`);
