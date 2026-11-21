export const binToolPath = "/tools/bin-lookup";
export const binDataPath = "/bin-data/issuer-regions-fcc907c.bin";
export const binSource = "https://github.com/Techbuddie-Solutions/binlist-data/tree/fcc907c81cf02b12e396b0c12a8c16472b47619a";
export const binLicense = "https://creativecommons.org/licenses/by/4.0/";
export const binTitle = "银行卡 BIN 地区查询";
export const binDescription = "根据银行卡号开头的数字查询发卡国家或地区。";

export function binPrefix(input: string) {
  if (input.length > 40) return;
  const digits = input.normalize("NFKC").replace(/[\s-]/g, "");
  if (/^(?:[0-9]{6}|[0-9]{8})$/.test(digits)) return digits.slice(0, 6);
}

export function readBinRegions(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const regionCount = bytes[0];
  const offset = 1 + regionCount * 2;
  if (!regionCount || bytes.length !== offset + 1_000_000) throw new Error("Invalid BIN index");

  // The header stores two-letter region codes. Each six-digit BIN indexes one byte.
  const regions = Array.from({ length: regionCount }, (_, index) =>
    String.fromCharCode(bytes[1 + index * 2], bytes[2 + index * 2]));
  return (prefix: string) => regions[bytes[offset + Number(prefix)] - 1];
}
