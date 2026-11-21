"use client";

import { Minus, Send, Trash2 } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "@/components/site/language";
import { assistantCatalogHref, assistantInputLimit, assistantTurnLimit, isAssistantTool, readAssistantEvents, type AssistantMessage } from "@/lib/assistant/protocol";
import { AssistantMarkdown } from "./assistant-markdown";

const AVATAR_URL = "/assistant-avatar.jpg";
const questions = ["绑卡被拒怎么排查原因？", "免税州地址怎么选最稳？", "帮我算算开哪家 AI 最划算"] as const;

type Turn = { id: number; question: string; answer: string; complete: boolean; unable?: boolean; links?: string[] };

export function Assistant({ enabled, currentTool }: { enabled: boolean; currentTool?: string }) {
  const t = useTranslations();
  const pathname = usePathname();
  const tool = currentTool ?? pathname;
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController>(null);
  const sequence = useRef(0);
  const launcher = useRef<HTMLButtonElement>(null);
  const minimize = useRef<HTMLButtonElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const count = [...draft].length;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (open) minimize.current?.focus();
  }, [open]);
  useEffect(() => {
    const element = transcript.current;
    if (element && open && follow.current) element.scrollTop = turns.length ? element.scrollHeight : 0;
  }, [turns, open, pending, error]);

  function hide() {
    setOpen(false);
    launcher.current?.focus();
  }

  function clear() {
    request.current?.abort();
    request.current = null;
    follow.current = true;
    setTurns([]);
    setError("");
    setDraft("");
    setPending(false);
  }

  async function send(input: string) {
    const question = input.trim();
    if (!enabled || request.current || !question || [...question].length > assistantInputLimit) return;
    const id = ++sequence.current;
    const abort = new AbortController();
    request.current = abort;
    const messages: AssistantMessage[] = turns.filter((turn) => turn.complete).slice(-(assistantTurnLimit - 1))
      .flatMap(({ question, answer, links }) => [{ role: "user", content: question },
        { role: "assistant", content: links?.length ? answer.replace(/\[([^\]\n]+)\]\([^\s)]+\)/g, "$1") : answer }]);
    messages.push({ role: "user", content: question });
    follow.current = true;
    setError("");
    setDraft("");
    setPending(true);
    setTurns((items) => [...items.slice(-(assistantTurnLimit - 1)), { id, question, answer: "", complete: false }]);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ messages, currentTool: isAssistantTool(tool) ? tool : undefined }),
      });
      if (abort.signal.aborted) return;
      if (response.status === 429) {
        setError("本喵还在忙，请稍后再问喵。");
        return;
      }
      if (!response.ok || !response.body) throw new Error("Assistant unavailable.");
      let answer = "";
      let unable = false;
      for await (const data of readAssistantEvents(response.body)) {
        if (abort.signal.aborted) return;
        if (data === "[DONE]" && (answer.trim() || unable)) {
          setTurns((items) => items.map((item) => item.id === id ? { ...item, complete: Boolean(answer.trim()), unable } : item));
          return;
        }
        const event = JSON.parse(data);
        if (event.sticker === "unable") { unable = true; continue; }
        if (typeof event.text !== "string") throw new Error("Assistant reply interrupted.");
        answer += event.text;
        const updated = answer;
        const links: string[] | undefined = Array.isArray(event.links)
          ? event.links.flatMap((value: unknown) => assistantCatalogHref(value) ?? []) : undefined;
        setTurns((items) => items.map((item) => item.id === id ? { ...item, answer: updated, links: links ?? item.links } : item));
      }
      throw new Error("Assistant reply ended early.");
    } catch {
      if (!abort.signal.aborted) setError("本喵的回复中断了，稍后再试试喵。");
    } finally {
      if (request.current === abort) {
        request.current = null;
        setPending(false);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  if (pathname?.startsWith("/admin")) return null;

  return <div className="site-assistant" data-open={open}>
    <section className="assistant-panel" id="site-assistant-panel" role="dialog" aria-labelledby="site-assistant-title"
      inert={!open} onKeyDown={(event) => { if (event.key === "Escape") hide(); }}>
      <header className="assistant-header">
        <Image className="assistant-avatar" src={AVATAR_URL} alt="" width={40} height={40} unoptimized referrerPolicy="no-referrer" />
        <div className="assistant-heading">
          <h2 id="site-assistant-title">{t("山海小助手")}</h2>
          <p className="assistant-status" data-enabled={enabled}>{enabled ? t("由 DeepSeek 提供回答") : t("助手暂不可用")}</p>
        </div>
        <button type="button" aria-label={t("清空对话")} title={t("清空对话")} onClick={clear}
          disabled={!turns.length && !draft}><Trash2 size={17} /></button>
        <button ref={minimize} type="button" aria-label={t("收起助手")} title={t("收起助手")} onClick={hide}><Minus size={19} /></button>
      </header>

      <div className="assistant-transcript" ref={transcript} onScroll={({ currentTarget }) => {
        follow.current = currentTarget.scrollHeight - currentTarget.scrollTop - currentTarget.clientHeight < 48;
      }}>
        {visited && <div className="assistant-welcome">
          <Image className="assistant-sticker" src="/assistant-welcome.webp" alt={t("脆皮已上线")} width={600} height={600} unoptimized />
          <p>Ciallo～(∠・ω&lt; )⌒★</p>
          {enabled && !turns.length && <div className="assistant-prompts">{questions.map((question) =>
            <button type="button" key={question} onClick={() => void send(t(question))}>{t(question)}</button>)}</div>}
        </div>}
        {turns.map((turn) => <div className="assistant-turn" key={turn.id}>
          <p className="assistant-question">{turn.question}</p>
          {!!turn.answer && <div className="assistant-reply"><AssistantMarkdown text={turn.answer} links={turn.links} /></div>}
          {turn.unable && <Image className="assistant-sticker" src="/assistant-unable.webp" alt={t("山海小助手暂时答不上来")} width={600} height={800} unoptimized />}
        </div>)}
        {pending && <p className="assistant-progress" role="status">{t("正在回复…")}</p>}
        {error && <p className="assistant-error" role="status">{t(error)}</p>}
      </div>

      <form className="assistant-form" onSubmit={submit}>
        <div className="assistant-composer">
          <textarea rows={2} value={draft} disabled={!enabled} aria-label={t("输入你的问题")} placeholder={t("输入你的问题")}
            aria-describedby="site-assistant-privacy" onChange={(event) => setDraft([...event.target.value].slice(0, assistantInputLimit).join(""))} />
          <div className="assistant-send">
            <span aria-hidden="true">{count}/{assistantInputLimit}</span>
            <button type="submit" aria-label={t("发送消息")} title={t("发送消息")}
              disabled={!enabled || pending || !draft.trim()}><Send size={17} /></button>
          </div>
        </div>
        <p id="site-assistant-privacy">{t("聊天内容发往 DeepSeek。请勿填写完整卡号、密码、密钥或验证码。")}</p>
      </form>
    </section>
    <button className="assistant-launcher" ref={launcher} type="button" aria-expanded={open} aria-controls="site-assistant-panel"
      aria-label={t(open ? "收起助手" : "打开山海小助手")} title={t(open ? "收起助手" : "打开山海小助手")}
      onClick={() => { if (open) hide(); else { setVisited(true); setOpen(true); } }}>
      <Image className="assistant-avatar" src={AVATAR_URL} alt="" width={60} height={60} unoptimized referrerPolicy="no-referrer" />
      {!visited && enabled && <span className="assistant-hint" aria-hidden="true" />}
    </button>
  </div>;
}
