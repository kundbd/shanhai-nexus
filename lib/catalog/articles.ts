import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getGuide } from "./index";

const articles = new Map<string, string>();

export function readArticle(id: string): string {
  if (!getGuide(id)) throw new Error(`Unknown article: ${id}`);
  const cached = articles.get(id);
  if (cached && process.env.NODE_ENV !== "development") return cached;
  const body = readFileSync(join(process.cwd(), "content", "articles", `${id}.md`), "utf8");
  articles.set(id, body);
  return body;
}
