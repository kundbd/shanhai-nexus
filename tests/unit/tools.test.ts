import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TOOL_INPUT, decodeBase64, encodeBase64, formatJSON, fromDate, fromTimestamp, hashText, transformUrl } from "../../lib/tools/functions";
import { compareText } from "../../lib/tools/diff";

test("JSON formatting preserves exact number and string tokens", () => {
  const raw = '{"n":9223372036854775807,"n":3,"text":"a  b"}';
  const pretty = formatJSON(raw, "pretty", 4);
  assert.ok(pretty.includes('\n    "n": 9223372036854775807,'));
  assert.equal(formatJSON(pretty, "minify"), raw);
  assert.match(formatJSON("null", "validate"), /语法有效/);
  assert.throws(() => formatJSON('{\n "x": true,\n}', "validate"), /第 \d+ 行/);
  assert.throws(() => formatJSON('{"x":/*bad*/true}', "validate"), /注释/);
  assert.throws(() => formatJSON("01", "validate"), /JSON|数字/);
  assert.throws(() => formatJSON("[".repeat(130) + "]".repeat(130), "pretty"), /嵌套/);
});

test("Base64 round-trips UTF-8, standard and URL-safe forms", () => {
  for (const value of ["", "你好 🌊\n换行", "\uFEFFleading BOM", "a".repeat(50_000)]) {
    assert.equal(decodeBase64(encodeBase64(value)), value);
    assert.equal(decodeBase64(encodeBase64(value, true)), value);
  }
  assert.throws(() => decodeBase64("!!"), /Base64 格式/);
  assert.throws(() => decodeBase64("YR=="), /填充位/);
  assert.throws(() => decodeBase64("/w=="), /UTF-8/);
});

test("URL component and form encodings round-trip whitespace, symbols and Chinese", () => {
  const text = "山海 & 海图 +~!";
  for (const form of [false, true]) {
    const encoded = transformUrl(text, "encode", form);
    assert.equal(transformUrl(encoded, "decode", form), text);
    assert.equal(encoded, form ? new URLSearchParams({ q: text }).toString().slice(2) : encodeURIComponent(text));
  }
  assert.equal(transformUrl("a+b", "decode"), "a+b");
  assert.equal(transformUrl("a+b", "decode", true), "a b");
  assert.throws(() => transformUrl("%G1", "decode"), /百分号/);
  assert.throws(() => transformUrl("\uD800", "encode"), /Unicode/);
});

test("line diff identifies changes, line endings, blank inputs and limits", () => {
  const result = compareText("第一行\r\n删除\r\n", "第一行\n新增\n");
  assert.equal(result.output, "  第一行\n- 删除\n+ 新增");
  assert.equal(result.note, "新增 1 行，删除 1 行");
  assert.equal(compareText("same\r\n", "same\n").blocks.length, 0);
  assert.equal(compareText("", "").output, "两份文本相同。");
  assert.match(compareText("x", "x\n").output, /末行无换行/);
  assert.match(compareText("", "新增").output, /^\+ 新增/);
  assert.throws(() => compareText("x\n".repeat(2001), ""), /2,000/);
  assert.throws(() => compareText("", "x".repeat(80_001)), /80,000/);
});

test("timestamps respect units, negative numbers, fractional seconds and calendar bounds", () => {
  assert.equal(fromTimestamp("1704067200", "seconds").toISOString(), "2024-01-01T00:00:00.000Z");
  assert.equal(fromTimestamp("-0.123", "seconds").getTime(), -123);
  assert.equal(fromTimestamp("1704067200123", "milliseconds").getUTCMilliseconds(), 123);
  assert.equal(fromDate("2024-01-01T08:00:00+08:00").getTime(), 1704067200000);
  assert.equal(fromDate("2024-02-29T00:00:00.001Z").getUTCMilliseconds(), 1);
  assert.throws(() => fromDate("2023-02-29T00:00Z"), /有效范围/);
  assert.throws(() => fromDate("2024-01-01T00:00"), /带时区/);
  assert.throws(() => fromTimestamp("999999999999999999", "seconds"), /范围/);
  assert.throws(() => fromTimestamp("1.5", "milliseconds"), /整数/);
});

test("SHA-256 matches known test vectors and compares uppercase or mismatching hashes", () => {
  const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  assert.deepEqual(hashText("abc", abc.toUpperCase()), { digest: abc, matches: true });
  assert.equal(hashText("abc ", abc).matches, false);
  assert.equal(hashText("").digest, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.throws(() => hashText("abc", "bad"), /64 位/);
  assert.throws(() => hashText("a".repeat(MAX_TOOL_INPUT + 1)), /200,000/);
});
