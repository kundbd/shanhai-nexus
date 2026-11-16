export type Tone = "teal" | "blue" | "amber" | "indigo";
export type ToolId = "json" | "base64" | "timestamp" | "sha256" | "url" | "diff";

export type Tool = {
  id: ToolId;
  title: string;
  description: string;
  category: string;
  icon: string;
  tone: Tone;
  tags: string[];
  keywords: string[];
};

export type Guide = {
  id: string;
  title: string;
  description: string;
  kind: "guide" | "article" | "solution";
  category: string;
  difficulty: "入门" | "进阶";
  minutes: number;
  verified: string;
  tags: string[];
  keywords: string[];
  sources: { title: string; url: string }[];
  relatedTool?: ToolId;
  relatedGuides?: string[];
  diagnosis?: string;
};

export interface ContentRepository {
  listTools(): readonly Tool[];
  listGuides(): readonly Guide[];
}

export const guideKindLabels = { guide: "教程", article: "知识文章", solution: "常见问题" };
