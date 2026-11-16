import { test } from "node:test";
import assert from "node:assert/strict";
import { guides, tools, getGuide, getTool } from "../../lib/catalog";
import { diagnosisService } from "../../lib/diagnosis";
import { searchCatalog } from "../../lib/search";
import { workspaces } from "../../lib/tools/workspaces";
import { readArticle } from "../../lib/catalog/articles";
import { createSearchService } from "../../lib/search/provider";

test("search ranks natural-language requests and synonyms, filters by kind, and handles no matches", () => {
  for (const text of ["PDF变Word", "PDF转DOCX", "我想把 PDF 转换成 DOCX 怎么办"]) {
    assert.equal(searchCatalog(text)[0]?.href, "/guides/pdf-to-word", text);
  }
  assert.equal(searchCatalog("JSON 格式化")[0]?.href, "/tools/json");
  assert.equal(searchCatalog("AI API 返回 429", "solution")[0]?.href, "/guides/api-429");
  assert.equal(searchCatalog("SSH 连不上", "solution")[0]?.href, "/guides/ssh-connection");
  assert.equal(searchCatalog("SSH 连不上", "diagnosis")[0]?.href, "/diagnose?topic=ssh");
  assert.equal(searchCatalog("域名解析失败")[0]?.href, "/guides/dns-resolution");
  assert.deepEqual(searchCatalog("xyqxydirt888"), []);
  assert.deepEqual(searchCatalog("  👋 "), []);
  assert.ok(searchCatalog("AI网关").every(({category})=>category==="AI 接口"));
});

test("full-text retrieval finds body-only terms, ranks common tasks and links diagnoses", () => {
  assert.match(searchCatalog("169.254")[0]?.excerpt ?? "", /169\.254/);
  for (const [query, expected] of [
    ["电脑无法连接网络怎么办", "/guides/wifi-no-internet"],
    ["如何压缩图片但尽量保持画质", "/guides/compress-images"],
    ["怎样将视频转换为其他格式", "/guides/convert-video"],
    ["AI API 返回 429 是什么意思", "/guides/api-429"],
    ["CNAME", "/guides/dns-records"],
  ]) assert.equal(searchCatalog(query)[0]?.href, expected);
  assert.equal(searchCatalog("429", "diagnosis")[0]?.href, "/diagnose?topic=api&issue=429");
});

test("every search result points to its catalog entry, and every tool is registered", () => {
  assert.equal(tools.length, 6);
  assert.equal(guides.filter((item) => item.kind === "guide").length, 10);
  for (const tool of tools) assert.ok(workspaces[tool.id]);
  for (const item of [...tools, ...guides]) {
    const match = searchCatalog(item.title).find((result) => result.href.endsWith(`/${item.id}`));
    assert.ok(match, item.title);
    assert.equal(match.kind === "tool" ? getTool(item.id) : getGuide(item.id), item);
  }
  for (const guide of guides) {
    assert.match(readArticle(guide.id), /## 适用条件[\s\S]+## 操作步骤[\s\S]+## 常见问题/);
    assert.ok(guide.sources.length);
    for (const link of guide.sources) assert.equal(new URL(link.url).protocol, "https:");
    for (const id of guide.relatedGuides ?? []) assert.ok(getGuide(id));
    if (guide.relatedTool) assert.ok(getTool(guide.relatedTool));
    if (guide.diagnosis) assert.ok(diagnosisService.find(guide.diagnosis));
  }
});

test("diagnosis branches are acyclic and have valid solution links", () => {
  for (const flow of Object.values(diagnosisService.topics)) {
    assert.ok(flow.relatedTool && getTool(flow.relatedTool.id));
    const reachable = new Set<string>();
    function visit(id: string, ancestors: readonly string[]) {
      assert.ok(!ancestors.includes(id));
      const node = flow.nodes[id];
      assert.ok(node, id);
      reachable.add(id);
      if ("options" in node) {
        assert.ok(node.options.length);
        node.options.forEach((option) => visit(option.next, [...ancestors, id]));
      } else {
        assert.ok(getGuide(node.guide));
        assert.ok(node.steps.length);
      }
    }
    visit(flow.start, []);
    assert.equal(reachable.size, Object.keys(flow.nodes).length);
  }
  assert.equal(diagnosisService.find("__proto__"), undefined);
});

test("optional reranker only returns trusted candidates and falls back on errors and timeouts", async () => {
  const query = "AI API";
  const base = searchCatalog(query);
  assert.ok(base.length > 1);
  const reordered = createSearchService({ rank: async () => ["imaginary", base[1].id, base[1].id] });
  const output = await reordered.search(query);
  assert.equal(output[0].id, base[1].id);
  assert.deepEqual(new Set(output.map((item) => item.id)), new Set(base.map((item) => item.id)));
  const broken = createSearchService({ rank: async () => { throw new Error("Model unavailable"); } });
  assert.deepEqual(await broken.search(query), base);
  let signal: AbortSignal | undefined;
  const slow = createSearchService({ rank: (input) => {
    signal = input.signal;
    return new Promise(() => {});
  } }, 10);
  assert.deepEqual(await slow.search(query), base);
  assert.ok(signal?.aborted);
  assert.deepEqual(await slow.search(query), base);
});
