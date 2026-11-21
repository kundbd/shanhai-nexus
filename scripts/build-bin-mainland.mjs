import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Issuer codes matched to mainland institutions in bcbc's pinned name.csv.
// Keep overseas branches and ambiguous issuer codes out of this list.
const mainlandIssuers = new Set(`
  ABC ARCU ASCB AYCB BANKWF BDCBANK BGB BHB BJBANK BJRCB BOC BOCD BOCFCB
  BOCY BOCZ BOD BODD BOHAIB BOHN BOJZ BOL BOP BOQH BOQZ BOSH BOSZ BOYK
  BOZK BSB BZMD CAB CABANK CBBQS CBKF CCB CCQTGB CDB CDCB CDRCB CEB CGNB
  CIB CITI CITIC CJCCB CMB CMBC COMM CQBANK CRCBANK CSCB CSRCB CZBANK CZCB
  CZCCB CZRCB DAQINGB DLB DRCBCL DSBCN DTCCB DYCB DYCCB DZBANK DZCBANK
  EGBANK ERB ESRCB FBBANK FDB FJHXBC FJNX FMBANK FSCB FSCCB FXCB GCB GDB
  GDRCC GHB GLBANK GRCB GSBANK GSRCU GXHMVB GXRCU GYCB GZB GZRCU H3CB HBC
  HBHSBANK HBRCU HBYCBANK HDBANK HDHMCB HKB HLDB HLDCCB HLJRCU HNRCC HNRCU
  HRBANK HRXJB HSBANK HSBC HSBK HURCB HXBANK HZCB HZCCB ICBC JHBANK JINCHB
  JJBANK JLBANK JLRCU JNBANK JRCB JSB JSBANK JSRCU JXBANK JXRCU JZBANK JZCBANK
  KLB KMRCU KORLABANK KSRB KSRCB LANGFB LNRCC LSB LSBANK LSBC LSCCB LSZRCB
  LUZBANK LYBANK LYCB LZCCB LZYH MTBANK MYBANK NBBANK NBYZ NCB NCBANK NDHB
  NHB NHQS NJCB NMGNXS NTCCB NXBANK NXRCU NYBANK NYCB NYNB OCBC ORBANK PLCCB
  PSBC PZBANK PZHCCB QDCCB QDRCB QHDBANK QHDCCB QHRC QJCCB QLBANK QLCZYH
  RBOZ RXCB RZB RZCCB SCCB SCRCU SDEB SDRCU SHBANK SHRCB SJBANK SLH SLRCB
  SNCCB SPABANK SPDB SRBANK SRCB SXCB SXRCCU SXRCU SZSBK TACCB TCCB TCRCB
  TJBHB TLBANK TRCB TSBANK TZCB URB URMQCCB WHBANK WHCCB WHRCB WJRCB WOORI
  WRCB WXCCB WZCB XABANK XCYH XFRCB XHCZYH XHRCB XJRCU XLBANK XMBANK XMCCB
  XTB XXBANK XYBANK YACCB YBCCB YCCB YCCCB YDNSCZYH YDRCB YKYHCCB YNRCC
  YQCCB YTBANK YXCCB YZBANK ZBCB ZGCCB ZHCCB ZJCCB ZJKCCB ZJNX ZJTLCB
  ZRCBANK ZYB ZYCBANK ZZBANK ZZCCB
`.trim().split(/\s+/));

// Exact published prefixes. Source links are in public/bin-data/NOTICE.txt.
const official = new Set([
  // Shenzhen social security cards and Jilin University payroll cards
  "621467 621721 621462 623020 620522 621756 622908 622363 622823 622262 621791 623157 622622 623035 621797 621483 621770 623058 621463 621418",
  "62220242 62220842 621723 62170009 43674209 621786 601382 62179006 622848",
  // China Merchants Bank Mastercard debit (Cathay's co-branded offer) and credit
  "525612 531063 534293",
  "523649 537832 559899",
  // ICBC debit, Mastercard credit, UnionPay/Visa credit and Amex credit
  "622202 622203 621225 621226",
  "511704 532932 538176 517557 512600 522068 522601 523062 524625 525613 527324 527661 528032 529868 535887 539861 539888 518907 527052 537076 539579",
  "427020 489734 489735 427030 427039 427029 438126 458441 451810 427010 451811 458071 438125 427018 451804 489736 427019",
  "379981 379983 379905 379555 370517 379554",
  // Agricultural Bank of China Mastercard credit and UnionPay/Visa credit
  "536113 535051 518802",
  "403361 404117 404118 463758",
  // Bank of China Mastercard credit and UnionPay/Visa credit
  "512695 518474 541068 512732 522153 547628 513088 524055 547648 514957 524152 547775 516464 524206 553207 516465 524207 556632 516467 524209 558808 517813 524210 558809 518183 540297 558869 518216 540701 518473 540838",
  "409665 409666 409667 409668 409670 409672 438088",
  // China Construction Bank UnionPay/Visa credit. Keep only fully specified eight-digit blocks.
  "48959200 48959201 48959202 48959203 48959204 48959206 48959207 48959208 48959209 43674800 43674801 43674802 43674500 43674501 43674502 43673800",
  // Postal Savings Bank, China Minsheng Bank and China Guangfa Bank Mastercard credit
  "557968 559861 511176 557928 520218 528066",
  "512770 545217 552130",
  "543809 554088 558071 536998 537138",
  // Shanghai Pudong Development Bank UnionPay debit
  "621351 621352 621390 621791 621792 621793 621795 621796 622516 622517 622518 622519 622520 622521 622522 622523 623559 623658 620530",
].flatMap(group => group.split(" ")));

const [sourceDir] = process.argv.slice(2);
if (!sourceDir) throw new Error("Usage: node scripts/build-bin-mainland.mjs SOURCE_DIR");
const [header, ...rows] = readFileSync(join(sourceDir, "bin.csv"), "utf8").trim().split(/\r?\n/);
if (header !== "bin,bank,type,length") throw new Error("Unexpected bcbc CSV header");
const source = rows.map(row => row.split(","));
if (source.some(fields => fields.length !== 4)) throw new Error("Unexpected bcbc CSV row");
const [, ...issuerRows] = readFileSync(join(sourceDir, "name.csv"), "utf8").trim().split(/\r?\n/);
const issuerCodes = new Set(issuerRows.map(row => row.split(",")[0]));
for (const code of mainlandIssuers) {
  if (!issuerCodes.has(code)) throw new Error(`Missing mainland issuer: ${code}`);
}

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
