import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Issuer codes matched to mainland institutions in bcbc's pinned name.csv.
// Keep overseas branches and ambiguous issuer codes out of this list.
const mainlandIssuers = new Set(`
  ABC BJBANK BJRCB BOC BOQH BOSZ CCB CDCB CDRCB CEB CITIC CMB CMBC COMM
  CQBANK CRCBANK CSCB CSRCB DAQINGB DLB FJNX GCB GDB GDRCC GLBANK GYCB
  GZRCU HBC HKB HNRCC HRBANK HSBANK HXBANK HZCB ICBC JHBANK JLBANK JRCB
  JSBANK JSRCU LZCCB LZYH MTBANK NBBANK NBYZ NCB NJCB NXBANK PSBC QDCCB
  SCRCU SDEB SDRCU SHBANK SHRCB SJBANK SPABANK SPDB SRCB SXRCU TCCB TRCB
  TZCB URB URMQCCB WHRCB WJRCB WXCCB WZCB YNRCC ZJNX ZJTLCB ZYB ZYCBANK CIB
`.trim().split(/\s+/));

// ICBC product page, Shenzhen Human Resources and Social Security Bureau,
// and Jilin University payroll notice, respectively. Links are in NOTICE.txt.
const official = new Set(`
  622202 622203 621225 621226
  621467 621721 621462 623020 620522 621756 622908 622363 622823 622262
  621791 623157 622622 623035 621797 621483 621770 623058 621463 621418
  62220242 62220842 621723 62170009 43674209 621786 601382 62179006 622848
`.trim().split(/\s+/));

const [sourceDir] = process.argv.slice(2);
if (!sourceDir) throw new Error("Usage: node scripts/build-bin-mainland.mjs SOURCE_DIR");
const [header, ...rows] = readFileSync(join(sourceDir, "bin.csv"), "utf8").trim().split(/\r?\n/);
if (header !== "bin,bank,type,length") throw new Error("Unexpected bcbc CSV header");
const source = rows.map(row => row.split(","));
if (source.some(fields => fields.length !== 4)) throw new Error("Unexpected bcbc CSV row");

const baseIndex = readFileSync("public/bin-data/issuer-regions-fcc907c.bin");
const baseOffset = 1 + 2 * baseIndex[0];
function baseRegion(prefix) {
  const region = baseIndex[baseOffset + Number(prefix.slice(0, 6))];
  const offset = 1 + 2 * (region - 1);
  return region ? baseIndex.toString("ascii", offset, offset + 2) : undefined;
}

const ambiguous = new Set();
for (const [prefix, issuer] of source) {
  if (mainlandIssuers.has(issuer)) continue;
  if (/^\d{6,}$/.test(prefix)) ambiguous.add(prefix.slice(0, 6));
  if (/^\d{8,}$/.test(prefix)) ambiguous.add(prefix.slice(0, 8));
}

const supplement = new Set([...official].filter(prefix => prefix.length === 8 || baseRegion(prefix) !== "CN"));
for (const [prefix, issuer] of source) {
  if (!/^(?:\d{6}|\d{8})$/.test(prefix) || !mainlandIssuers.has(issuer) || ambiguous.has(prefix)) continue;
  const region = baseRegion(prefix);
  if (region === undefined || (region === "CN" && prefix.length === 8)) supplement.add(prefix);
}

const prefixes = [...supplement].sort();
writeFileSync("content/bin-mainland-prefixes.json", `${JSON.stringify(prefixes, null, 2)}\n`);
console.log(`Mainland supplement: ${prefixes.filter(prefix => prefix.length === 6).length} six-digit, ${prefixes.filter(prefix => prefix.length === 8).length} eight-digit prefixes`);
