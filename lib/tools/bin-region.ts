export const binToolPath = "/tools/bin-lookup";
export const binSource = "https://github.com/Techbuddie-Solutions/binlist-data/tree/fcc907c81cf02b12e396b0c12a8c16472b47619a";
export const binLicense = "https://creativecommons.org/licenses/by/4.0/";
export const binTitle = "银行卡 BIN 地区查询";
export const binDescription = "根据银行卡号前 6 位或前 8 位查询发卡地区、发卡银行、卡组织和卡片类型。";

export function binPrefix(input: string) {
  if (input.length > 40) return;
  const digits = input.normalize("NFKC").replace(/[\s-]/g, "");
  if (/^(?:[0-9]{6}|[0-9]{8})$/.test(digits)) return digits;
}
