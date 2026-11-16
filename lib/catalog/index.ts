import toolsData from "@/content/tools.json";
import guidesData from "@/content/guides.json";
import type { ContentRepository, Guide, Tool } from "./types";

const repository: ContentRepository = {
  listTools: () => toolsData as Tool[],
  listGuides: () => guidesData as Guide[],
};

export const tools = repository.listTools();
export const guides = repository.listGuides();
export const getTool = (id: string) => tools.find((entry) => entry.id === id);
export const getGuide = (id: string) => guides.find((entry) => entry.id === id);
export const toolHref = (id: string) => `/tools/${id}`;
export const guideHref = (id: string) => `/guides/${id}`;

export const latestGuides = [...guides]
  .filter((guide) => guide.kind === "guide")
  .sort((left, right) => right.verified.localeCompare(left.verified));
