import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { tools } from "../../lib/catalog";
import { searchCatalog } from "../../lib/search";
import { binDataPath, binPrefix, binToolPath, readBinRegions } from "../../lib/tools/bin-region";

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
  const data = readFileSync(`public${binDataPath}`);
  const lookup = readBinRegions(new Uint8Array(data).buffer);
  assert.equal(binPrefix("４５７１ ７３６０"), "457173");
  assert.equal(binPrefix(" 457173 "), "457173");
  for (const invalid of ["", "45717", "4571736", "457173600", "1234567890123456", "457x73"]) {
    assert.equal(binPrefix(invalid), undefined);
  }
  assert.equal(lookup("457173"), "DK");
  assert.equal(lookup("622202"), "CN");
  assert.equal(lookup("000000"), undefined);
  assert.throws(() => readBinRegions(new ArrayBuffer(1)), /Invalid BIN index/);
});
