import type { NextRequest } from "next/server";
import { assistantCatalogHref, assistantReplyLimit, readAssistantEvents } from "@/lib/assistant/protocol";
import { assistantCatalogIntent, assistantCatalogReply } from "@/lib/assistant/catalog";
import { assistantSiteEvidence, assistantSiteReply } from "@/lib/assistant/site-content";
import { assistantMessages, assistantModel, assistantSystemPrompt, assistantUnableMarker, assistantVoice, hasAssistantVoice, isAssistantRefusal, reserveAssistantRequest } from "@/lib/assistant/server";
import { directory } from "@/lib/directory/db";
import { boundedText } from "@/lib/directory/imports";
import { visibilityForHeaders } from "@/lib/geo/request";
import { defaultLanguage, isSiteLanguage, languageCookie } from "@/lib/i18n/language";
import { siteConsentCookie, siteConsentVersion } from "@/lib/site-consent";
import { sameOriginBrowserRequest } from "@/lib/site-request";

export const runtime = "nodejs";

const eventHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no",
};
const endEvent = "data: [DONE]\n\n";
const eventFrame = (value: object) => `data: ${JSON.stringify(value)}\n\n`;

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
  const savedLanguage = request.cookies.get(languageCookie)?.value;
  const language = isSiteLanguage(savedLanguage) ? savedLanguage : defaultLanguage;
  const voice = assistantVoice(language);
  const question = messages.at(-1)!.content;
  let references: ReturnType<typeof assistantSiteEvidence>;
  try {
    const db = directory();
    const visibility = await visibilityForHeaders(request.headers);
    const intent = assistantCatalogIntent(question);
    const direct = assistantSiteReply(question, db, visibility, language) ?? (intent && assistantCatalogReply(intent, db, visibility, language));
    if (direct) {
      reservation.release();
      return new Response(eventFrame({ ...direct, text: `${voice.lookup}\n\n${direct.text}` }) + endEvent, { headers: eventHeaders });
    }
    references = assistantSiteEvidence(question, db, visibility);
  } catch {
    reservation.release();
    return errorResponse("unavailable", 503);
  }
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
        messages: [{ role: "system", content: assistantSystemPrompt(body.currentTool, references) }, ...messages],
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
  let opening: string | undefined = "";
  let replyLead = "";
  let unable = false;
  let spokenInCharacter = false;
  let links = references.flatMap(reference => assistantCatalogHref(reference.href) ?? []);
  const eventData = (value: object) => encoder.encode(eventFrame(value));
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { value, done } = await stream.next();
          if (done) break;
          if (value === "[DONE]") {
            if (opening?.trim()) controller.enqueue(eventData({ text: opening }));
            if (unable || isAssistantRefusal(replyLead)) controller.enqueue(eventData({ sticker: "unable" }));
            if (unable && !replyLead.trim()) controller.enqueue(eventData({ text: voice.unable }));
            else if (size && !spokenInCharacter) controller.enqueue(eventData({ text: `\n\n${voice.close}` }));
            if (size || unable) controller.enqueue(encoder.encode(endEvent));
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
          if (size > assistantReplyLimit - 12) break;
          let text = content;
          if (opening !== undefined) {
            opening += content;
            const start = opening.trimStart();
            if (start.length < assistantUnableMarker.length && assistantUnableMarker.startsWith(start)) continue;
            unable = start.startsWith(assistantUnableMarker);
            text = unable ? start.slice(assistantUnableMarker.length).trimStart() : opening;
            opening = undefined;
          }
          if (!text) continue;
          if (replyLead.length < 400) replyLead += text.slice(0, 400 - replyLead.length);
          spokenInCharacter ||= hasAssistantVoice(text) || hasAssistantVoice(replyLead);
          controller.enqueue(eventData({ text, ...(links.length && { links }) }));
          links = [];
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
  }), { headers: eventHeaders });
}
