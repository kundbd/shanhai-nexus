import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { tools } from "../../lib/catalog";
import { searchCatalog } from "../../lib/search";
import { binCardDataPath, readBinCards } from "../../lib/tools/bin-cards";
import { binPrefix, binToolPath } from "../../lib/tools/bin-region";
import { billingToolPath } from "../../lib/tools/billing-address";
import { classifyIceAddress, compareBrowserRegion, envToolPath } from "../../lib/tools/env-check";
import { parseTotp, totpCode, totpToolPath } from "../../lib/tools/totp";

const lookup = readBinCards(new Uint8Array(readFileSync(`public${binCardDataPath}`)).buffer);

test("the public tools are indexed by site search", () => {
  assert.deepEqual(tools.map(tool => tool.href), [binToolPath, totpToolPath, billingToolPath, envToolPath]);
  for (const query of ["BIN", "发卡地区", "發卡地區", "BIN lookup", "银行卡地区识别"]) {
    assert.equal(searchCatalog(query, "tool")[0]?.href, binToolPath, query);
  }
  assert.deepEqual(searchCatalog("JSON 格式化"), []);
  assert.deepEqual(searchCatalog(""), []);
  assert.deepEqual(searchCatalog("BIN", undefined, () => false), []);
  assert.equal(searchCatalog("两步验证", "tool")[0]?.href, totpToolPath);
  assert.equal(searchCatalog("US billing address", "tool")[0]?.href, billingToolPath);
  assert.equal(searchCatalog("WebRTC", "tool")[0]?.href, envToolPath);
});

test("browser region checks distinguish matches, differences and missing signals", () => {
  assert.deepEqual(compareBrowserRegion("US", "US/Eastern", "en-US"),
    { timezoneMatch: "match", languageMatch: "match", status: "green" });
  assert.equal(compareBrowserRegion("GB", "Europe/London", "fr-GB").status, "green");
  assert.equal(compareBrowserRegion("IN", "Asia/Calcutta", "en-IN").status, "green");
  assert.equal(compareBrowserRegion("HK", "Asia/Shanghai", "zh-CN").status, "red");
  assert.equal(compareBrowserRegion("CN", "Asia/Shanghai", "en-US").status, "yellow");
  assert.equal(compareBrowserRegion("CN", "Asia/Shanghai", "zh-Hans").languageMatch, "unknown");
  assert.equal(compareBrowserRegion("AU", "UTC", "en-AU").timezoneMatch, "unknown");
  assert.deepEqual(compareBrowserRegion(undefined, "Asia/Shanghai", "zh-CN"),
    { timezoneMatch: "unknown", languageMatch: "unknown", status: "yellow" });
});

test("ICE address categories distinguish masked addresses, IPv4, and IPv6", () => {
  for (const address of ["10.0.0.7", "192.168.1.10", "100.64.0.1", "fd00::1", "::ffff:172.16.1.4"]) {
    assert.equal(classifyIceAddress(address), "local", address);
  }
  assert.equal(classifyIceAddress("93.184.216.34"), "public");
  assert.equal(classifyIceAddress("2001:4860:4860::8888"), "public");
  assert.equal(classifyIceAddress("0.0.0.0"), "unknown");
  assert.equal(classifyIceAddress("8dae5a3b-0b1a-4ffc.local."), "masked");
  assert.equal(classifyIceAddress("invalid.local.example"), "unknown");
});

test("TOTP parses setup links and matches RFC 6238 test vectors", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const parsed = parseTotp(secret.toLowerCase());
  assert.equal(parsed.period, 30);
  assert.equal(parsed.digits, 6);
  assert.deepEqual(parseTotp(`otpauth://totp/Test?secret=${secret}&algorithm=SHA1&digits=8&period=45`),
    { ...parsed, digits: 8, period: 45 });
  for (const invalid of ["A", "MZ======", "BASE32!", `otpauth://hotp/Test?secret=${secret}`,
    `otpauth://totp/Test?secret=${secret}&period=0`, `otpauth://totp/Test?secret=${secret}&algorithm=MD5`]) {
    assert.throws(() => parseTotp(invalid));
  }
  const testKey = "1234567890".repeat(7);
  for (const [hash, length, expected] of [
    ["SHA-1", 20, "94287082"],
    ["SHA-256", 32, "46119246"],
    ["SHA-512", 64, "90693936"],
  ] as const) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(testKey.slice(0, length)),
      { name: "HMAC", hash }, false, ["sign"]);
    assert.equal(await totpCode(key, 1, 8), expected);
  }
});

test("the published index matches known regions and accepts only a BIN-length input", () => {
  assert.equal(binPrefix("４５７１ ７３６０"), "45717360");
  assert.equal(binPrefix(" 457173 "), "457173");
  for (const invalid of ["", "45717", "4571736", "457173600", "1234567890123456", "457x73"]) {
    assert.equal(binPrefix(invalid), undefined);
  }
  assert.equal(lookup("457173")?.card[0], "DK");
  assert.equal(lookup("622202")?.card[0], "CN");
  assert.equal(lookup("000000"), undefined);
  assert.throws(() => readBinCards(new ArrayBuffer(1)), /Invalid card index/);
});

test("the mainland supplement fills gaps without assuming all 62 prefixes are from China", () => {
  for (const prefix of ["621225", "621226", "621721", "621785", "621786", "621799"]) {
    assert.equal(lookup(prefix)?.card[0], "CN", prefix);
    assert.equal(lookup(prefix)?.digits, 6, prefix);
  }
  assert.equal(lookup("62220842")?.digits, 8);
  assert.equal(lookup("62122642")?.digits, 6);
  assert.equal(lookup("62220843")?.digits, 6);
  assert.equal(lookup("620202")?.card[0], "HK");
  assert.equal(lookup("629999"), undefined);
});

test("published mainland debit and credit prefixes coexist with other Mastercard regions", () => {
  for (const prefix of ["534293", "531063", "525612", "523649", "537832", "536113", "543809"]) {
    assert.equal(lookup(prefix)?.card[0], "CN", prefix);
  }
  assert.deepEqual(lookup("53429300"), { card: ["CN", "招商银行", "MASTERCARD", "DEBIT"], digits: 6 });
  assert.deepEqual(lookup("537832"), { card: ["CN", "招商银行", "MASTERCARD", "CREDIT"], digits: 6 });
  assert.deepEqual(lookup("43674502"), { card: ["CN", "中国建设银行", "UNIONPAY / VISA", "CREDIT"], digits: 8 });
  assert.equal(lookup("43674599")?.digits, 6);
  assert.deepEqual(lookup("510195"), { card: ["MY", "BANK SIMPANAN NASIONAL", "MASTERCARD", "CREDIT"], digits: 6 });
  assert.deepEqual(lookup("457173")?.card, ["DK", "", "", "DEBIT"]);
});
