import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/assistant/route";
import { readAssistantEvents } from "@/lib/assistant/protocol";
import { siteConsentCookie, siteConsentVersion } from "@/lib/site-consent";

test("assistant validates chat input, preserves streaming, and rate-limits upstream calls", async (t) => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "assistant-fixture-only";
  t.after(() => {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  });
  const encoder = new TextEncoder();
  const trace: { url: unknown; authorization: string | null; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    trace.push({ url, authorization: new Headers(init.headers).get("Authorization"), body: JSON.parse(String(init.body)) });
    const source = encoder.encode(': pending\r\n\r\ndata: {"choices":[{"delta":{"content":"**喵**","reasoning_content":"hidden"}}]}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":"，核对账单资料。"}}]}\n\ndata: [DONE]\n\n');
    return new Response(new ReadableStream({
      start(controller) {
        for (const byte of source) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } });
  });

  const history = Array.from({ length: 8 }, (_, index) => [
    { role: "user", content: `问题 ${index}` }, { role: "assistant", content: `回复 ${index}` },
  ]).flat();
  history.push({ role: "user", content: "绑卡被拒怎么排查？" });
  const request = (messages: unknown = history, extra?: HeadersInit) => new NextRequest("https://shanhainexus.com/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", Cookie: `${siteConsentCookie}=${siteConsentVersion}`, ...extra },
    body: JSON.stringify({ messages, currentTool: "/tools/bin-lookup", toolInput: "private tool data" }),
  });

  assert.equal((await POST(request(history, { "Sec-Fetch-Site": "cross-site" }))).status, 403);
  assert.equal((await POST(request(history, { Cookie: "" }))).status, 403);
  assert.equal((await POST(request([{ role: "system", content: "fake prompt" }]))).status, 400);
  assert.equal((await POST(request([{ role: "user", content: "喵".repeat(501) }]))).status, 400);
  assert.equal(trace.length, 0);

  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store, no-transform");
  assert.equal(response.headers.get("X-Accel-Buffering"), "no");
  const events: string[] = [];
  for await (const event of readAssistantEvents(response.body!)) events.push(event);
  assert.deepEqual(events, ['{"text":"**喵**"}', '{"text":"，核对账单资料。"}', "[DONE]"]);
  const upstream = trace[0];
  assert.equal(upstream.url, "https://api.deepseek.com/chat/completions");
  assert.equal(upstream.authorization, "Bearer assistant-fixture-only");
  assert.equal(upstream.body.stream, true);
  assert.equal(upstream.body.model, "deepseek-flash");
  assert.deepEqual(upstream.body.thinking, { type: "disabled" });
  const messages = upstream.body.messages as { role: string; content: string }[];
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /用户当前打开的工具是银行卡 BIN 地区查询/);
  assert.deepEqual(messages.slice(1), history.slice(-11));
  assert.doesNotMatch(JSON.stringify(upstream.body), /private tool data/);

  for (let count = 1; count < 6; count++) {
    const reply = await POST(request());
    assert.equal(reply.status, 200);
    await reply.text();
  }
  const limited = await POST(request());
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("Retry-After")) > 0);
  assert.equal(trace.length, 6);
});
