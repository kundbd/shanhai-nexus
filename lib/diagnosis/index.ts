import data from "@/content/diagnosis.json";
import type { Tone, ToolId } from "@/lib/catalog/types";

type Question = { question: string; options: { label: string; next: string }[] };
type Outcome = { title: string; steps: string[]; guide: string };
export type DiagnosisNode = Question | Outcome;

export type DiagnosisFlow = {
  label: string;
  description: string;
  icon: string;
  tone: Tone;
  category: string;
  keywords: string[];
  start: string;
  nodes: Record<string, DiagnosisNode>;
  relatedTool?: { id: ToolId; label: string };
};

export interface DiagnosisService {
  topics: Readonly<Record<string, DiagnosisFlow>>;
  find(topic: string): DiagnosisFlow | undefined;
}

const topics = data as Record<string, DiagnosisFlow>;
export const diagnosisHref = (topic: string, issue?: "429") =>
  `/diagnose?${new URLSearchParams({ topic, ...(issue ? { issue } : {}) })}`;

export const diagnosisService: DiagnosisService = {
  topics,
  find: (topic) => Object.hasOwn(topics, topic) ? topics[topic] : undefined,
};
