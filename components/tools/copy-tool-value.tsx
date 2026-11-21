"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "@/components/site/language";

export function CopyToolValue({ value, label, expiresAt }: { value: string; label: string; expiresAt?: number }) {
  const t = useTranslations();
  const [feedback, setFeedback] = useState<{ value: string; expiresAt?: number; message: string }>();

  async function copy() {
    if (!value || (expiresAt !== undefined && Date.now() >= expiresAt)) return;
    try {
      await navigator.clipboard.writeText(value);
      setFeedback({ value, expiresAt, message: "已复制" });
    } catch {
      setFeedback({ value, expiresAt, message: "请手动复制" });
    }
  }

  return <div className="tool-actions">
    <button type="button" className="button" disabled={!value} onClick={copy}>
      <Copy size={16} aria-hidden="true" />{t(label)}
    </button>
    <span role="status" className="tool-feedback">
      {feedback && feedback.value === value && feedback.expiresAt === expiresAt ? t(feedback.message) : ""}
    </span>
  </div>;
}
