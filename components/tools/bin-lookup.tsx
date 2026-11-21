"use client";

import { useRef, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { useSiteLanguage, useTranslations } from "@/components/site/language";
import { matchMainlandBin } from "@/lib/tools/bin-mainland";
import { binDataPath, binPrefix, readBinRegions } from "@/lib/tools/bin-region";

type LookupResult =
  | { status: "idle" | "invalid" | "loading" | "missing" | "unavailable" }
  | { status: "found"; code: string; digits: number };

let regionIndex: Promise<ReturnType<typeof readBinRegions>> | undefined;

function loadRegionIndex() {
  return regionIndex ??= fetch(binDataPath, { credentials: "omit", signal: AbortSignal.timeout(15_000) })
    .then(response => {
      if (!response.ok) throw new Error("BIN index unavailable");
      return response.arrayBuffer();
    })
    .then(readBinRegions)
    .catch((error: unknown) => {
      regionIndex = undefined;
      throw error;
    });
}

export function BinLookup() {
  const t = useTranslations();
  const language = useSiteLanguage();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<LookupResult>({ status: "idle" });
  const busy = result.status === "loading";
  const country = result.status === "found"
    ? (result.code === "CN" ? t("中国大陆") : new Intl.DisplayNames(language, { type: "region" }).of(result.code))
    : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const prefix = binPrefix(input.current?.value ?? "");
    if (!prefix) {
      setResult({ status: "invalid" });
      return;
    }
    const mainland = matchMainlandBin(prefix);
    if (mainland) {
      setResult({ status: "found", ...mainland });
      return;
    }
    setResult({ status: "loading" });
    try {
      const lookup = await loadRegionIndex();
      const code = lookup(prefix.slice(0, 6));
      setResult(code ? { status: "found", code, digits: 6 } : { status: "missing" });
    } catch {
      setResult({ status: "unavailable" });
    }
  }

  return <form className="surface bin-lookup" onSubmit={submit} autoComplete="off">
    <label htmlFor="bin-prefix">{t("银行卡号前 6 位或前 8 位")}</label>
    <div className="bin-lookup-controls">
      <input id="bin-prefix" ref={input} type="text" inputMode="numeric" autoComplete="off" spellCheck={false}
        aria-describedby="bin-lookup-help" aria-invalid={result.status === "invalid"} disabled={busy}
        onChange={() => setResult({ status: "idle" })} />
      <button className="button primary" type="submit" disabled={busy}>
        <Search size={16} aria-hidden="true" />{t("查询")}
      </button>
    </div>
    <p id="bin-lookup-help" className="section-note">{t("仅输入卡号开头的数字。这个工具在浏览器本地查询。")}</p>
    {result.status === "invalid" && <p className="form-error" role="alert">{t("请输入卡号前 6 位或前 8 位数字。")}</p>}
    {result.status === "unavailable" && <p className="form-error" role="alert">{t("地区数据暂时无法加载，请重试。")}</p>}
    <div aria-live="polite">
      {busy && <p className="section-note">{t("正在加载地区数据…")}</p>}
      {result.status === "missing" && <p className="section-note">{t("未找到该 BIN 的可靠地区记录。")}</p>}
      {result.status === "found" && <dl className="bin-lookup-result">
        <dt>{t("发卡国家或地区")}</dt>
        <dd>{country} <span className="category-tag">{result.code}</span></dd>
        <dd className="section-note">{t("根据 BIN 前 {digits} 位匹配，结果供参考。", { digits: result.digits })}</dd>
      </dl>}
    </div>
  </form>;
}
