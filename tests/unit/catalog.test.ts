import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { tools } from "../../lib/catalog";
import { searchCatalog } from "../../lib/search";
import { binCardDataPath, readBinCards } from "../../lib/tools/bin-cards";
import { binPrefix, binToolPath } from "../../lib/tools/bin-region";

const lookup = readBinCards(new Uint8Array(readFileSync(`public${binCardDataPath}`)).buffer);

test("the BIN tool is the only tool indexed by site search", () => {
  assert.deepEqual(tools.map(tool => tool.href), [binToolPath]);
  for (const query of ["BIN", "发卡地区", "發卡地區", "BIN lookup", "银行卡地区识别"]) {
    assert.equal(searchCatalog(query, "tool")[0]?.href, binToolPath, query);
  }
  assert.deepEqual(searchCatalog("JSON 格式化"), []);
  assert.deepEqual(searchCatalog(""), []);
  assert.deepEqual(searchCatalog("BIN", undefined, () => false), []);
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
