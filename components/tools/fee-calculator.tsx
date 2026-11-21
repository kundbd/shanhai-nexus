"use client";

import { useState } from "react";
import { useSiteLanguage, useTranslations } from "@/components/site/language";
import { cnyPerEuro, feeCosts, feeCurrencies, feeRateDate, feeRateSource, type FeeCurrency } from "@/lib/tools/fee-calculator";

const currencies = Object.keys(feeCurrencies) as FeeCurrency[];
const presets = [
  { currency: "USD", price: "20" },
  { currency: "HKD", price: "100" },
  { currency: "JPY", price: "3000" },
] as const;

function referenceRate(currency: FeeCurrency) {
  return String(Number((cnyPerEuro / feeCurrencies[currency]).toFixed(6)));
}

export function FeeCalculator() {
  const t = useTranslations();
  const language = useSiteLanguage();
  const [currency, setCurrency] = useState<FeeCurrency>("USD");
  const [price, setPrice] = useState("20");
  const [overrides, setOverrides] = useState<Partial<Record<FeeCurrency, string>>>({});
  const [topup, setTopup] = useState("0");
  const [conversion, setConversion] = useState("0");
  const rate = overrides[currency] ?? referenceRate(currency);
  const result = price.trim() && rate.trim()
    ? feeCosts(Number(price), Number(rate), Number(topup), Number(conversion)) : undefined;
  const currencyNames = new Intl.DisplayNames(language, { type: "currency" });
  const yuan = new Intl.NumberFormat(language, { style: "currency", currency: "CNY" });
  const numbers = new Intl.NumberFormat(language, { maximumFractionDigits: 6 });
  const fields = [
    { id: "fee-price", label: "外币原价", value: price, update: setPrice },
    { id: "fee-rate", label: "参考汇率（每单位外币兑人民币）", value: rate,
      update: (value: string) => setOverrides(previous => ({ ...previous, [currency]: value })) },
    { id: "fee-topup", label: "充值手续费率（%）", value: topup, update: setTopup },
    { id: "fee-conversion", label: "跨境或货币转换费率（%）", value: conversion, update: setConversion },
  ];

  return <div className="surface tool-workbench">
    <div className="tool-actions" aria-label={t("快捷预设")}>
      {presets.map(preset => <button key={preset.currency} type="button" className="button" onClick={() => {
        setCurrency(preset.currency);
        setPrice(preset.price);
      }}>{preset.price} {preset.currency}</button>)}
    </div>
    <div className="tool-form fee-fields">
      <div className="tool-field">
        <label htmlFor="fee-currency">{t("外币币种")}</label>
        <select id="fee-currency" value={currency} onChange={event => setCurrency(event.currentTarget.value as FeeCurrency)}>
          {currencies.map(code => <option key={code} value={code}>{code} · {currencyNames.of(code)}</option>)}
        </select>
      </div>
      {fields.map(({ id, label, value, update }) => <div className="tool-field" key={id}>
        <label htmlFor={id}>{t(label)}</label>
        <input id={id} type="number" inputMode="decimal" min={0} step="any" value={value}
          autoComplete="off" onChange={event => update(event.currentTarget.value)} />
      </div>)}
    </div>
    <div className="tool-result" aria-live="polite">
      <dl className="tool-address-fields fee-results">
        <div><dt>{t("实际折合人民币总成本")}</dt><dd>{result ? yuan.format(result.total) : "—"}</dd></div>
        <div><dt>{t("综合损耗金额")}</dt><dd>{result ? yuan.format(result.loss) : "—"}</dd></div>
        <div><dt>{t("综合实际汇率")}</dt><dd>{result ? `${numbers.format(result.effectiveRate)} CNY / ${currency}` : "—"}</dd></div>
      </dl>
      {!result && <p className="section-note">{t("请输入有效汇率和非负金额、费率。")}</p>}
    </div>
    <p className="section-note">{t("先按原价计跨境转换费，再对所需入账金额加收充值费。损耗为两项费用合计。")}</p>
    <p className="section-note">{t("内置参考汇率日期：{date}", { date: feeRateDate })} ·{" "}
      <a className="text-link" href={feeRateSource} target="_blank" rel="noreferrer">{t("欧洲央行参考汇率")}</a>
    </p>
    <p className="section-note">{t("所有计算均在浏览器本地完成，不记录任何输入数据")}</p>
  </div>;
}
