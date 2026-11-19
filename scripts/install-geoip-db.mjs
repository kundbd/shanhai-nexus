import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import maxmind from "maxmind";

const limit = 64 * 1024 * 1024;
const [archive, destination] = process.argv.slice(2);
if (!archive || !destination || process.argv.length !== 4) {
  throw new Error("Usage: node scripts/install-geoip-db.mjs <country.mmdb.gz or country.mmdb> <destination.mmdb>");
}

const input = await stat(archive);
if (!input.isFile() || input.size > limit) throw new Error("Invalid Country MMDB file size");
const raw = await readFile(archive);
const data = archive.endsWith(".gz") ? gunzipSync(raw, { maxOutputLength: limit }) : raw;
const database = new maxmind.Reader(data);
if (!/country/i.test(database.metadata.databaseType) || database.metadata.nodeCount < 1) {
  throw new Error("The file is not a Country MMDB");
}

const target = resolve(destination);
const temporary = `${target}.${randomUUID()}.tmp`;
await mkdir(dirname(target), { recursive:true });
try {
  await writeFile(temporary,data,{flag:"wx",mode:0o640});
  await rename(temporary,target);
} finally {
  await rm(temporary,{force:true});
}
console.log(`Installed ${database.metadata.databaseType} (${data.length} bytes)`);
