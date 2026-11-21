"use client";

import { useState } from "react";
import { useTranslations } from "@/components/site/language";
import { generatePassword, generateTestProfile, type PasswordGroup } from "@/lib/tools/account-helper";
import { CopyToolValue } from "./copy-tool-value";

const groupOptions: ReadonlyArray<[PasswordGroup, string]> = [
  ["upper", "大写字母"], ["lower", "小写字母"], ["digits", "数字"], ["symbols", "特殊符号"],
];

export function AccountHelper() {
  const t = useTranslations();
  const [length, setLength] = useState(20);
  const [groups, setGroups] = useState<PasswordGroup[]>(() => groupOptions.map(([group]) => group));
  const [password, setPassword] = useState<ReturnType<typeof generatePassword>>();
  const [generation, setGeneration] = useState(0);
  const [profile, setProfile] = useState<ReturnType<typeof generateTestProfile>>();
  const strength = password && (password.entropy >= 80 ? "很强" : password.entropy >= 64 ? "强"
    : password.entropy >= 48 ? "一般" : "较弱");
  const profileFields = profile ? [
    { label: "英文名（First Name）", value: profile.firstName, copy: "复制英文名" },
    { label: "英文姓氏（Last Name）", value: profile.lastName, copy: "复制英文姓氏" },
    { label: "出生日期", value: profile.birthday, copy: "复制出生日期" },
    { label: "用户名", value: profile.username, copy: "复制用户名" },
  ] : [];

  return <div className="surface tool-workbench">
    <section className="account-helper-section" aria-labelledby="account-password-heading">
      <h2 id="account-password-heading" className="tool-section-heading">{t("随机密码")}</h2>
      <div className="tool-form">
        <label htmlFor="password-length">{t("密码长度")} <span>{t("{count} 位", { count: length })}</span></label>
        <input id="password-length" type="range" min={12} max={32} step={1} value={length}
          aria-valuetext={t("{count} 位", { count: length })} onChange={event => {
            setLength(Number(event.currentTarget.value));
            setPassword(undefined);
          }} />
        <fieldset className="password-groups">
          <legend>{t("字符类型")}</legend>
          {groupOptions.map(([group, label]) => <label key={group}>
            <input type="checkbox" checked={groups.includes(group)} onChange={event => {
              const checked = event.currentTarget.checked;
              setGroups(previous => checked ? [...previous, group] : previous.filter(item => item !== group));
              setPassword(undefined);
            }} />{t(label)}
          </label>)}
        </fieldset>
        {!groups.length && <p className="section-note">{t("请选择至少一种字符。")}</p>}
        <button type="button" className="button primary tool-submit" disabled={!groups.length} onClick={() => {
          setPassword(generatePassword(length, groups));
          setGeneration(previous => previous + 1);
        }}>{t("生成密码")}</button>
      </div>
      {password && strength && <div className="tool-result">
        <code className="generated-password" aria-label={t("生成的密码")}>{password.password}</code>
        <p className="section-note">{t("强度估算 · {strength} · 至少 {bits} 位随机熵", {
          strength: t(strength), bits: password.entropy,
        })}</p>
        <CopyToolValue key={generation} value={password.password} label="复制密码" />
      </div>}
    </section>
    <section className="account-helper-section" aria-labelledby="account-profile-heading">
      <h2 id="account-profile-heading" className="tool-section-heading">{t("测试注册资料")}</h2>
      <p className="section-note">{t("出生日期按 18–65 岁成年范围生成，格式为 YYYY-MM-DD。")}</p>
      <button type="button" className="button primary tool-submit" onClick={() => setProfile(generateTestProfile())}>{t("生成测试资料")}</button>
      {profile && <dl className="tool-result profile-fields">
        {profileFields.map(field => <div key={field.label}>
          <dt>{t(field.label)}</dt>
          <dd><span>{field.value}</span><CopyToolValue label={field.copy} value={field.value} /></dd>
        </div>)}
      </dl>}
    </section>
    <p className="section-note">{t("所有数据均在浏览器本地即时生成，不联网、不留存，仅用于日常防撞库及表单测试")}</p>
  </div>;
}
