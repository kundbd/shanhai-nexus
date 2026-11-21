"use client";

import { useRef, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { useSiteLanguage, useTranslations } from "@/components/site/language";
import { binCardDataPath, readBinCards, type BinCard } from "@/lib/tools/bin-cards";
import { binPrefix } from "@/lib/tools/bin-region";

type LookupResult =
  | { status: "idle" | "invalid" | "loading" | "missing" | "unavailable" }
  | { status: "found"; card: BinCard; digits: number };

const cardTypes: Readonly<Record<string, string>> = {
  CREDIT: "信用卡",
  DEBIT: "借记卡",
  PREPAID: "预付卡",
  "CHARGE CARD": "签账卡",
  "QUASI-CREDIT": "准贷记卡",
};

const cardBrands: Readonly<Record<string, string>> = {
  VISA: "Visa",
  MASTERCARD: "万事达卡（Mastercard）",
  UNIONPAY: "银联（UnionPay）",
  "UNIONPAY / VISA": "银联 / Visa",
  "AMERICAN EXPRESS": "美国运通（American Express）",
  "DINERS CLUB": "Diners Club",
  "PRIVATE LABEL": "专用卡网络",
  "LOCAL BRAND": "本地卡网络",
};

let cardIndex: Promise<ReturnType<typeof readBinCards>> | undefined;

function loadCardIndex() {
  return cardIndex ??= fetch(binCardDataPath, { credentials: "omit", signal: AbortSignal.timeout(15_000) })
    .then(response => {
      if (!response.ok) throw new Error("BIN index unavailable");
      return response.arrayBuffer();
    })
    .then(readBinCards)
    .catch((error: unknown) => {
      cardIndex = undefined;
      throw error;
    });
}

export function BinLookup() {
  const t = useTranslations();
  const language = useSiteLanguage();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<LookupResult>({ status: "idle" });
  const busy = result.status === "loading";
  const [code, issuer, brand, type] = result.status === "found" ? result.card : [];
  const country = code === "CN" ? t("中国大陆")
    : code && new Intl.DisplayNames(language, { type: "region" }).of(code);
  const missing = t("暂无资料");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const prefix = binPrefix(input.current?.value ?? "");
    if (!prefix) {
      setResult({ status: "invalid" });
      return;
    }
    setResult({ status: "loading" });
    try {
      const lookup = await loadCardIndex();
      const match = lookup(prefix);
      setResult(match ? { status: "found", ...match } : { status: "missing" });
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
    {result.status === "unavailable" && <p className="form-error" role="alert">{t("银行卡数据暂时无法加载，请重试。")}</p>}
    <div aria-live="polite">
      {busy && <p className="section-note">{t("正在加载银行卡数据…")}</p>}
      {result.status === "missing" && <p className="section-note">{t("未找到该 BIN 的可靠记录。")}</p>}
      {result.status === "found" && <div className="bin-lookup-result">
        <dl className="bin-lookup-fields">
          <div><dt>{t("发卡国家或地区")}</dt><dd>{country} <span className="category-tag">{code}</span></dd></div>
          <div><dt>{t("发卡银行")}</dt><dd>{issuer ? t(issuer) : missing}</dd></div>
          <div><dt>{t("卡组织")}</dt><dd>{brand ? t(cardBrands[brand] ?? brand) : missing}</dd></div>
          <div><dt>{t("卡片类型")}</dt><dd>{type ? t(cardTypes[type]) : missing}</dd></div>
        </dl>
        <p className="section-note">{t("根据 BIN 前 {digits} 位匹配，结果供参考。", { digits: result.digits })}</p>
      </div>}
    </div>
  </form>;
}
