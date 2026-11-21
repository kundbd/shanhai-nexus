"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "@/components/site/language";
import { checkLocalIce, compareBrowserRegion, type IceCheck, type RegionMatch } from "@/lib/tools/env-check";

const comparisons: Record<RegionMatch, string> = {
  match: "一致", different: "有差异", unknown: "无法判断",
};
const regionStates = {
  green: "时区和语言地区一致",
  yellow: "存在差异或信息不足",
  red: "时区和语言地区均有差异",
};
const iceStates: Record<IceCheck, { tone: "green" | "yellow" | "red"; label: string }> = {
  public: { tone: "red", label: "观察到公网候选地址" },
  local: { tone: "yellow", label: "观察到本地 IP 地址暴露" },
  masked: { tone: "green", label: "仅观察到 mDNS 掩码" },
  none: { tone: "yellow", label: "未观察到候选地址" },
  incomplete: { tone: "yellow", label: "本地检查未完成" },
  unavailable: { tone: "yellow", label: "当前浏览器无法进行 WebRTC 检查" },
};

function browserDetails() {
  const client = navigator as Navigator & { userAgentData?: { platform?: string } };
  return {
    timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    languages: navigator.languages?.join(", ") || navigator.language,
    screen: `${screen.width} × ${screen.height}`,
    platform: client.userAgentData?.platform || navigator.platform,
    userAgent: navigator.userAgent,
  };
}

export function EnvCheck({ country, region }: { country?: string; region?: string }) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<ReturnType<typeof browserDetails>>();
  const [ice, setIce] = useState<IceCheck>();

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSnapshot(browserDetails());
      void checkLocalIce(controller.signal).then(result => {
        if (!controller.signal.aborted) setIce(result);
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [revision]);

  const match = snapshot && compareBrowserRegion(country, snapshot.timezone, snapshot.language);
  const iceStatus = ice && iceStates[ice];
  const pending = t("检测中…");
  const unavailable = t("暂无资料");
  const fields: [string, string | undefined][] = [
    ["IP 所在地区", region && country ? `${region} (${country})` : t("未识别")],
    ["浏览器时区", snapshot?.timezone],
    ["浏览器首选语言", snapshot?.languages],
    ["屏幕分辨率（CSS 像素）", snapshot?.screen],
    ["平台信息", snapshot?.platform],
    ["User-Agent", snapshot?.userAgent],
  ];

  return <div className="surface tool-workbench">
    <dl className="tool-address-fields env-fields">
      {fields.map(([label, value]) => <div key={label} className={label === "User-Agent" ? "env-user-agent" : undefined}>
        <dt>{t(label)}</dt>
        <dd>{value || (snapshot ? unavailable : pending)}</dd>
      </div>)}
    </dl>
    <div className="tool-result" aria-live="polite">
      <h2 className="env-heading">{t("地区一致性")}</h2>
      <span className="env-status" data-tone={match?.status ?? "yellow"}>{match ? t(regionStates[match.status]) : pending}</span>
      {match && <p className="section-note">{t("时区 {timezone} · 语言地区 {language}", {
        timezone: t(comparisons[match.timezoneMatch]), language: t(comparisons[match.languageMatch]),
      })}</p>}
      {match && match.status !== "green" && <p className="section-note">{t("如设置有误，请核对系统时区和浏览器首选语言。")}</p>}
      <p className="section-note">{t("旅行或语言偏好可能造成差异。注册或支付时请确认平台支持你所在的地区，并填写真实的账户和账单信息。")}</p>
    </div>
    <div className="tool-result" aria-live="polite">
      <h2 className="env-heading">{t("WebRTC 本地检查")}</h2>
      <span className="env-status" data-tone={iceStatus?.tone ?? "yellow"}>{iceStatus ? t(iceStatus.label) : pending}</span>
      <p className="section-note">{t("仅检查浏览器暴露的本地候选地址。公网出口需要外部观测才能验证。")}</p>
    </div>
    <div className="tool-actions">
      <button type="button" className="button" disabled={!ice} onClick={() => {
        setSnapshot(undefined);
        setIce(undefined);
        setRevision(previous => previous + 1);
      }}>{t("重新检测")}</button>
    </div>
    <p className="section-note">{t("所有检测均在浏览器本地完成，不上传任何设备指纹数据")}</p>
  </div>;
}
