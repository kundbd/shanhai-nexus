import type { NextRequest } from "next/server";
import { assistantReplyLimit, readAssistantEvents } from "@/lib/assistant/protocol";
import { assistantMessages, assistantModel, assistantSystemPrompt, reserveAssistantRequest } from "@/lib/assistant/server";
import { boundedText } from "@/lib/directory/imports";
import { siteConsentCookie, siteConsentVersion } from "@/lib/site-consent";
import { sameOriginBrowserRequest } from "@/lib/site-request";

export const runtime = "nodejs";

function errorResponse(error: string, status: number, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(request: NextRequest) {
  if (!sameOriginBrowserRequest(request) || request.cookies.get(siteConsentCookie)?.value !== siteConsentVersion) {
    return errorResponse("forbidden", 403);
  }
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) return errorResponse("unavailable", 503);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    return errorResponse("invalid_input", 415);
  }

  let body: { messages?: unknown; currentTool?: unknown };
  try {
    body = JSON.parse(await boundedText(request, 128 * 1024));
  } catch {
    return errorResponse("invalid_input", 400);
  }
  const messages = assistantMessages(body?.messages);
  if (!messages) return errorResponse("invalid_input", 400);

  const reservation = reserveAssistantRequest(request.headers);
  if (!reservation.release) return errorResponse("rate_limit", 429, { "Retry-After": String(reservation.retryAfter) });
  const upstreamAbort = new AbortController();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(50_000), upstreamAbort.signal]);
  signal.addEventListener("abort", reservation.release, { once: true });
  let upstream: Response;
  try {
    upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model: assistantModel, stream: true, thinking: { type: "disabled" }, max_tokens: 900,
        messages: [{ role: "system", content: assistantSystemPrompt(body.currentTool) }, ...messages],
      }),
      cache: "no-store", redirect: "error", signal,
    });
  } catch {
    reservation.release();
    return errorResponse("unavailable", 502);
  }
  if (!upstream.ok || !upstream.body || !upstream.headers.get("content-type")?.startsWith("text/event-stream")) {
    upstreamAbort.abort();
    reservation.release();
    return errorResponse("unavailable", 502);
  }

  const encoder = new TextEncoder();
  const stream = readAssistantEvents(upstream.body);
  let size = 0;
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { value, done } = await stream.next();
          if (done) break;
          if (value === "[DONE]") {
            if (size) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            else controller.enqueue(encoder.encode('data: {"error":"unavailable"}\n\n'));
            controller.close();
            upstreamAbort.abort();
            await stream.return(undefined).catch(() => {});
            return;
          }
          const event = JSON.parse(value);
          if (event.error) break;
          const content: unknown = event.choices?.[0]?.delta?.content;
          if (typeof content !== "string" || !content) continue;
          size += content.length;
          if (size > assistantReplyLimit) break;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: content })}\n\n`));
          return;
        }
      } catch {
        if (upstreamAbort.signal.aborted) return;
      }
      controller.enqueue(encoder.encode('data: {"error":"unavailable"}\n\n'));
      controller.close();
      upstreamAbort.abort();
      await stream.return(undefined).catch(() => {});
    },
    async cancel() {
      upstreamAbort.abort();
      await stream.return(undefined).catch(() => {});
    },
  }), { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no",
  } });
}
