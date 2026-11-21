"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "@/components/site/language";
import { parseTotp, totpCode } from "@/lib/tools/totp";
import { CopyToolValue } from "./copy-tool-value";

type Session = { key: CryptoKey; digits: number; period: number };

function TotpResult({ session, clear }: { session: Session; clear: () => void }) {
  const t = useTranslations();
  const [clock, setClock] = useState({ step: -1, seconds: 0 });
  const [code, setCode] = useState<{ step: number; value: string }>();
  const [error, setError] = useState(false);
  const duration = session.period * 1000;

  useEffect(() => {
    let active = true;
    let lastStep = -1;
    function refresh() {
      const now = Date.now();
      const step = Math.floor(now / duration);
      const seconds = Math.ceil(((step + 1) * duration - now) / 1000);
      setClock(previous => previous.step === step && previous.seconds === seconds ? previous : { step, seconds });
      if (step === lastStep) return;
      lastStep = step;
      void totpCode(session.key, step, session.digits).then(value => {
        if (!active || lastStep !== step) return;
        setError(false);
        setCode({ step, value });
      }).catch(() => {
        if (active && lastStep === step) setError(true);
      });
    }
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 200);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [session, duration]);

  const value = !error && code?.step === clock.step ? code.value : "";
  return <>
    {error && <p className="form-error" role="alert">{t("暂时无法生成验证码。")}</p>}
    <div className="tool-result">
      <div id="totp-code-label">{t("当前验证码")}</div>
      <output className="totp-code" aria-labelledby="totp-code-label" aria-live="off">{value || "—"}</output>
      <p className="section-note">{t("{seconds} 秒后刷新", { seconds: clock.seconds })}</p>
      <CopyToolValue value={value} expiresAt={(clock.step + 1) * duration} label="复制验证码" />
    </div>
    <div className="tool-actions">
      <button type="button" className="button" onClick={clear}>{t("清除密钥")}</button>
    </div>
  </>;
}

export function TotpGenerator() {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<Session>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !input.current) return;
    setError("");
    let settings;
    try {
      settings = parseTotp(input.current.value);
    } catch {
      setError("请输入有效的 Base32 密钥或 TOTP 设置链接。");
      return;
    }
    input.current.value = "";
    setBusy(true);
    try {
      const key = await crypto.subtle.importKey("raw", settings.secret, { name: "HMAC", hash: settings.hash }, false, ["sign"]);
      setSession({ key, digits: settings.digits, period: settings.period });
    } catch {
      setError("暂时无法生成验证码。");
    } finally {
      settings.secret.fill(0);
      setBusy(false);
    }
  }

  return <div className="surface tool-workbench">
    {session ? <TotpResult session={session} clear={() => setSession(undefined)} /> :
      <form className="tool-form" autoComplete="off" onSubmit={start}>
        <label htmlFor="totp-secret">{t("Base32 密钥或 TOTP 设置链接")}</label>
        <input id="totp-secret" ref={input} type="password" autoComplete="off" spellCheck={false}
          autoCapitalize="none" maxLength={2048} aria-describedby="totp-help" aria-invalid={Boolean(error)}
          onChange={() => setError("")} disabled={busy} required />
        <button className="button primary tool-submit" type="submit" disabled={busy}>{t("生成验证码")}</button>
        {error && <p role="alert" className="form-error">{t(error)}</p>}
      </form>}
    <p id="totp-help" className="section-note">{t("密钥只在当前页面使用，刷新或关闭页面后清除。")}</p>
  </div>;
}
