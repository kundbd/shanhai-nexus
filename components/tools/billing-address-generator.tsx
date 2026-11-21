"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "@/components/site/language";
import { billingStates, type BillingState } from "@/lib/tools/billing-address";
import { CopyToolValue } from "./copy-tool-value";

export function BillingAddressGenerator() {
  const t = useTranslations();
  const [stateCode, setStateCode] = useState<string>(billingStates[0].code);
  const [address, setAddress] = useState<{ state: BillingState; street: string }>();
  const state = billingStates.find(candidate => candidate.code === stateCode) ?? billingStates[0];

  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const number = 1000 + Math.floor(Math.random() * 9000);
    setAddress({ state, street: `${number} Shanhai Test Fixture Ave` });
  }

  return <div className="surface tool-workbench">
    <form className="tool-form" onSubmit={generate}>
      <label htmlFor="billing-state">{t("选择州")}</label>
      <select id="billing-state" value={stateCode} onChange={event => {
        setStateCode(event.currentTarget.value);
        setAddress(undefined);
      }}>
        {billingStates.map(item => <option key={item.code} value={item.code}>{t(item.name)} ({item.code})</option>)}
      </select>
      <button type="submit" className="button primary tool-submit">{t("生成示例地址")}</button>
    </form>
    <p className="section-note">{t("街道和门牌为虚构示例。实际账单请填写真实地址。")}</p>
    {state.code === "AK" && <p className="section-note">{t("阿拉斯加州没有州级销售税，部分城市和自治市镇征收地方销售税。")}</p>}
    {address && <div className="tool-result">
      <dl className="tool-address-fields" aria-live="polite">
        <div><dt>{t("街道地址")}</dt><dd>{address.street}</dd></div>
        <div><dt>{t("城市")}</dt><dd>{address.state.city}</dd></div>
        <div><dt>{t("州")}</dt><dd>{address.state.code}</dd></div>
        <div><dt>{t("邮政编码")}</dt><dd>{address.state.zip}</dd></div>
        <div><dt>{t("国家")}</dt><dd>United States</dd></div>
      </dl>
      <CopyToolValue
        value={`TEST ADDRESS\n${address.street}\n${address.state.city}, ${address.state.code} ${address.state.zip}\nUnited States`}
        label="复制示例地址"
      />
    </div>}
  </div>;
}
