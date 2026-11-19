"use client";

import { useSiteLanguage, useTranslations } from "@/components/site/language";

import { useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, Copy, RotateCcw } from "lucide-react";
import type { ToolId } from "@/lib/catalog/types";
import { MAX_TOOL_INPUT } from "@/lib/tools/functions";
import { workspaces, type WorkspaceResult } from "@/lib/tools/workspaces";

export function ToolWorkspace({ id }: { id: ToolId }) {
  const t = useTranslations();
  const language = useSiteLanguage();
  const workspace = workspaces[id];
  const [mode, setMode] = useState(workspace.modes[0]);
  const [option, setOption] = useState(workspace.option?.values[0].value ?? "");
  const [input, setInput] = useState("");
  const [expected, setExpected] = useState("");
  const [result, setResult] = useState<WorkspaceResult | null>(null);
  const [error, setError] = useState("");
  const [copy, setCopy] = useState("");
  const resultField = useRef<HTMLTextAreaElement>(null);
  const inputMax = (workspace.limit ?? MAX_TOOL_INPUT) + 1;
  const compare = workspace.extra?.multiline === true;

  function clearResult() {
    setResult(null);
    setError("");
    setCopy("");
  }

  function reset() {
    setInput("");
    setExpected("");
    setMode(workspace.modes[0]);
    setOption(workspace.option?.values[0].value ?? "");
    clearResult();
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.output);
      setCopy("已复制");
    } catch {
      const field = resultField.current;
      field?.focus();
      field?.select();
      let copied = false;
      try { copied = document.execCommand("copy"); } catch { /* Keep the text selected for manual copying. */ }
      setCopy(copied ? "已复制" : "已选中，请手动复制");
    }
  }

  function run() {
    clearResult();
    try {
      setResult(workspace.run(input, mode.value, option, expected, t, language));
    } catch (error) {
      setError(error instanceof Error ? error.message : "处理失败，请检查输入后重试。");
    }
  }

  function loadExample() {
    setInput(id === "timestamp" && mode.value === "timestamp" && option === "milliseconds" ? "1704067200000" : mode.example);
    setExpected(workspace.extra?.example ?? "");
    clearResult();
  }

  return <form className="surface workspace" onSubmit={(event) => { event.preventDefault(); run(); }}>
    <div className="workspace-toolbar">
      <div className="segments" aria-label={t("操作模式")}>
        {workspace.modes.length > 1 && workspace.modes.map((entry) => <button type="button" key={entry.value} aria-pressed={mode.value === entry.value} onClick={() => { setMode(entry); clearResult(); }}>{t(entry.label)}</button>)}
      </div>
      {workspace.option && (!workspace.option.mode || workspace.option.mode === mode.value) && <label className="workspace-select">{t(workspace.option.label)}<select value={option} onChange={(event) => { setOption(event.target.value); clearResult(); }}>{workspace.option.values.map((entry) => <option value={entry.value} key={entry.value}>{t(entry.label)}</option>)}</select></label>}
    </div>
    <div className="editors-grid">
      <div className="editor-pane">
        <div className="editor-heading"><label htmlFor="tool-input">{t(mode.inputLabel)}</label><button className="text-link" type="button" onClick={loadExample}>{t("载入示例")}</button></div>
        <textarea id="tool-input" autoComplete="off" aria-invalid={!!error} aria-describedby={error ? "tool-error" : undefined} spellCheck={false} maxLength={inputMax} value={input} placeholder={t(mode.placeholder)} onChange={(event) => { setInput(event.target.value); clearResult(); }} />
      </div>
      {compare && <div className="editor-pane">
        <div className="editor-heading"><label htmlFor="tool-revised">{t(workspace.extra?.label ?? "")}</label></div>
        <textarea id="tool-revised" autoComplete="off" aria-invalid={!!error} aria-describedby={error ? "tool-error" : undefined} spellCheck={false} maxLength={inputMax} value={expected} placeholder={t(workspace.extra?.placeholder ?? "")} onChange={(event) => { setExpected(event.target.value); clearResult(); }} />
      </div>}
      <div className={compare ? "editor-pane editor-full" : "editor-pane"}>
        <div className="editor-heading"><label htmlFor="tool-result">{t("处理结果")}</label><button type="button" className="text-link" disabled={!result} onClick={copyResult}>{copy === "已复制" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{t("复制结果")}</button></div>
        <textarea id="tool-result" className={compare ? "diff-result" : undefined} ref={resultField} readOnly value={result?.output ?? ""} placeholder={t("结果将在这里显示")} spellCheck={false} />
      </div>
    </div>
    {!!result?.blocks?.length && <div className="diff-preview" role="region" tabIndex={0} aria-label={t("差异高亮")}>
      {result.blocks.map((block, index) => <pre className={`diff-${block.kind}`} key={index}>{block.text.replace(/\n$/, "").split("\n").map((line) =>
        `${block.kind === "added" ? "+ " : block.kind === "removed" ? "- " : "  "}${line}`).join("\n")}</pre>)}
    </div>}
    {workspace.extra && !compare && <label className="workspace-expected">{t(workspace.extra.label)}<input value={expected} maxLength={128} placeholder={t(workspace.extra.placeholder)} autoComplete="off" spellCheck={false} onChange={(event) => { setExpected(event.target.value); clearResult(); }} /></label>}
    {error && <p id="tool-error" className="tool-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{t(error)}</p>}
    <div className="workspace-footer">
      <button type="submit" className="button primary">{t(mode.action)} <ArrowRight size={16} aria-hidden="true" /></button>
      <button type="button" className="button secondary" onClick={reset}><RotateCcw size={15} aria-hidden="true" />{t("重置")}</button>
      <span className="workspace-status" role="status">{copy ? t(copy) : result?.note || (result ? t("处理完成") : "")}</span>
    </div>
  </form>;
}
