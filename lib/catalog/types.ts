export type Tone = "teal" | "blue" | "amber" | "indigo";

export type Tool = {
  id: string;
  title: string;
  description: string;
  category: string;
  href: string;
  icon: string;
  tone: Tone;
  tags: string[];
  keywords: string[];
};
