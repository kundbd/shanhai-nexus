"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, RotateCcw } from "lucide-react";
import type { DiagnosisFlow } from "@/lib/diagnosis";
import { IconTile } from "@/components/catalog/icon";

export function DiagnosisWizard({ flows, initialTopic, initialStep }: { flows: Readonly<Record<string, DiagnosisFlow>>; initialTopic: string; initialStep: string }) {
  const [topic, setTopic] = useState(initialTopic);
  const [history, setHistory] = useState<string[]>(initialStep ? [initialStep] : []);
  const heading = useRef<HTMLHeadingElement>(null);
  const shouldFocus = useRef(false);
  const flow = flows[topic];
  const current = flow?.nodes[history.at(-1) ?? flow.start];

  useEffect(() => {
    if (shouldFocus.current) heading.current?.focus();
  }, [topic, history]);

  function choose(id: string) {
    shouldFocus.current = true;
    setTopic(id);
    setHistory([]);
  }

  if (!current) return <section aria-labelledby="choose-topic">
    <h2 id="choose-topic" ref={heading} tabIndex={-1} className="wizard-topic-heading">选择问题类型</h2>
    <div className="diagnose-grid">{Object.entries(flows).map(([id, entry]) => <button key={id} onClick={() => choose(id)} className="surface topic-card">
      <IconTile icon={entry.icon} tone={entry.tone} /><strong>{entry.label}</strong><span>{entry.description}</span><ArrowRight className="card-arrow" size={18} aria-hidden="true" />
    </button>)}</div>
  </section>;

  return <section className="wizard surface">
    <div className="wizard-top"><IconTile icon={flow.icon} tone={flow.tone} compact /><span>{flow.label}</span><button className="text-link" onClick={() => choose("")}><RotateCcw size={15} aria-hidden="true" />更换问题</button></div>
    {"question" in current ? <div className="wizard-body">
      <p className="eyebrow">第 {history.length + 1} 步</p>
      <h2 ref={heading} tabIndex={-1}>{current.question}</h2>
      <div className="wizard-options">{current.options.map((option) => <button key={option.label} onClick={() => { shouldFocus.current = true; setHistory([...history, option.next]); }}>{option.label}<ArrowRight size={16} aria-hidden="true" /></button>)}</div>
    </div> : <div className="wizard-body">
      <p className="eyebrow"><CheckCircle2 size={16} aria-hidden="true" />建议排查方向</p>
      <h2 ref={heading} tabIndex={-1}>{current.title}</h2>
      <ol className="wizard-steps">{current.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <Link className="button primary" href={`/guides/${current.guide}`}>查看完整方案 <ArrowRight size={16} aria-hidden="true" /></Link>
      {flow.relatedTool && <Link className="button secondary diagnosis-tool" href={`/tools/${flow.relatedTool.id}`}>{flow.relatedTool.label} <ArrowRight size={16} aria-hidden="true" /></Link>}
    </div>}
    {history.length > 0 && <div className="wizard-bottom"><button className="text-link" onClick={() => { shouldFocus.current = true; setHistory(history.slice(0, -1)); }}><ArrowLeft size={16} aria-hidden="true" />上一步</button></div>}
  </section>;
}
