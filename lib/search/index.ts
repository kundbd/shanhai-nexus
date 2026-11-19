import { guideHref, guides, toolHref, tools } from "@/lib/catalog";
import { readArticle } from "@/lib/catalog/articles";
import { diagnosisHref, diagnosisService } from "@/lib/diagnosis";
import { canonicalize, compact, MAX_QUERY_LENGTH, queryTerms } from "./query";

export const resultLabels = { tool: "工具", guide: "教程", article: "知识文章", solution: "常见问题", diagnosis: "诊断流程" };
export type ResultKind = keyof typeof resultLabels;
export type SearchResult = {
  id: string;
  kind: ResultKind;
  title: string;
  description: string;
  category: string;
  tags: readonly string[];
  href: string;
  excerpt?: string;
};

type IndexEntry = { result: SearchResult; fields: { values: string[]; shortWords: Set<string>; weight: number }[]; paragraphs: string[] };

function makeEntry(result: SearchResult, keywords: readonly string[], paragraphs: string[] = []): IndexEntry {
  const fields = [
    { values: [result.title], weight: 12 },
    { values: [...result.tags], weight: 9 },
    { values: [...keywords], weight: 8 },
    { values: [result.description], weight: 6 },
    { values: [result.category], weight: 3 },
    { values: paragraphs, weight: 2 },
  ].map(({ values, weight }) => {
    const normalized=values.map(canonicalize);
    return { values: normalized.map(compact), shortWords: new Set(normalized.flatMap((value)=>value.match(/\b[a-z]{1,2}\b/g)??[])), weight };
  });
  return { result, fields, paragraphs };
}

function buildIndex(): IndexEntry[] {
  const makeId = (kind: ResultKind, id: string) => `${kind}:${id}`;
  return [
    ...tools.map(({ id, title, description, category, tags, keywords }) => makeEntry(
      { id: makeId("tool", id), title, description, category, tags, kind: "tool", href: toolHref(id) }, keywords,
    )),
    ...guides.map(({ id, title, kind, description, category, tags, keywords }) => {
      const paragraphs = readArticle(id).split(/\r?\n/).map((line) => line.replace(/^#+\s+(?:\d+\.\s*)?/, "").trim()).filter((line) => line && !line.startsWith("```"));
      return makeEntry({ id: makeId(kind, id), title, description, category, tags, kind, href: guideHref(id) }, keywords, paragraphs);
    }),
    ...Object.entries(diagnosisService.topics).map(([id, flow]) => {
      const { keywords, category } = flow;
      const paragraphs = Object.values(flow.nodes).flatMap((node) => "question" in node
        ? [node.question, ...node.options.map(({ label }) => label)]
        : [node.title, ...node.steps]);
      return makeEntry({ id: makeId("diagnosis", id), title: flow.label, description: flow.description,
        category, tags: keywords.slice(0, 3), kind: "diagnosis", href: diagnosisHref(id) }, keywords, paragraphs);
    }),
  ];
}

let index: IndexEntry[] | undefined;

function excerpt(entry: IndexEntry, words: string[], phrase: string): string | undefined {
  const candidates = entry.paragraphs.filter((line) => line.length > 12);
  const best = candidates.map((line) => {
    const normalized = compact(canonicalize(line));
    const score = (phrase.length > 2 && normalized.includes(phrase) ? 10 : 0) +
      words.filter((word) => normalized.includes(word)).length;
    return { line, score };
  }).sort((a, b) => b.score - a.score)[0];
  if (!best?.score) return undefined;
  const point = Math.max(0, Math.min(...words.map((word) => best.line.toLowerCase().indexOf(word)).filter((position) => position >= 0), best.line.length));
  const start = point === best.line.length ? 0 : Math.max(0, point - 22);
  const end = start + 106;
  return `${start > 0 ? "…" : ""}${best.line.slice(start, end)}${end < best.line.length ? "…" : ""}`;
}

export function searchCatalog(rawQuery: string, kind?: ResultKind, visible?: (result: SearchResult)=>boolean): SearchResult[] {
  const normalized = canonicalize(rawQuery.slice(0, MAX_QUERY_LENGTH).trim());
  const phrase = compact(normalized);
  if (!phrase) return [];
  const { words, grams } = queryTerms(normalized);
  const records = process.env.NODE_ENV === "development" ? buildIndex() : (index ??= buildIndex());
  return records
    .filter(({ result }) => (!kind || result.kind === kind) && (!visible || visible(result)))
    .map((entry) => {
      const { result, fields } = entry;
      const phraseScore = fields.reduce((total, { values, weight }) =>
        total + (values.includes(phrase) ? weight * 8
          : phrase.length >= 2 && values.some((value) => value.includes(phrase)) ? weight * 4
            : values.some((value) => value.length >= 4 && phrase.includes(value)) ? weight * 2 : 0), 0);
      const weightFor = (term: string) => fields.find(({ values,shortWords }) =>
        /^[a-z]{1,2}$/.test(term)?shortWords.has(term):values.some((value) => value.includes(term)))?.weight ?? 0;
      const letterScores = words.map((term) => weightFor(compact(term)));
      const gramScores = grams.map(weightFor);
      const coverage = letterScores.filter(Boolean).length / (words.length || 1);
      const score = phraseScore + letterScores.reduce((sum, value) => sum + value * (1 + coverage), 0) +
        Math.min(18, gramScores.reduce((sum, value) => sum + value * 0.32, 0));
      const matched = letterScores.filter(Boolean).length;
      const relevant = phraseScore > 0 || (matched >= Math.min(2, words.length) && coverage >= 0.5) ||
        (gramScores.filter(Boolean).length >= 2 && (words.length === 0 || coverage >= 0.5));
      return { entry, result, score: relevant ? score : 0 };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry, result }) => ({
      ...result,
      href: result.id === "diagnosis:api" && /(?<!\d)429(?!\d)/.test(normalized) ? diagnosisHref("api", "429") : result.href,
      excerpt: excerpt(entry, words, phrase),
    }));
}
