import { tools } from "@/lib/catalog";
import { canonicalize, compact, MAX_QUERY_LENGTH, queryTerms } from "./query";

export const resultLabels = { tool: "工具" };
export type ResultKind = keyof typeof resultLabels;
export type SearchResult = {
  id: string;
  kind: ResultKind;
  title: string;
  description: string;
  category: string;
  tags: readonly string[];
  href: string;
};

const records = tools.map(({ id, title, description, category, tags, keywords, href }) => {
  const result: SearchResult = { id: `tool:${id}`, kind: "tool", title, description, category, tags, href };
  const fields = [
    { values: [result.title], weight: 12 },
    { values: [...result.tags], weight: 9 },
    { values: [...keywords], weight: 8 },
    { values: [result.description], weight: 6 },
    { values: [result.category], weight: 3 },
  ].map(({ values, weight }) => {
    const normalized=values.map(canonicalize);
    return { values: normalized.map(compact), shortWords: new Set(normalized.flatMap((value)=>value.match(/\b[a-z]{1,2}\b/g)??[])), weight };
  });
  return { result, fields };
});

export function searchCatalog(rawQuery: string, kind?: ResultKind, visible?: (result: SearchResult)=>boolean): SearchResult[] {
  const normalized = canonicalize(rawQuery.slice(0, MAX_QUERY_LENGTH).trim());
  const phrase = compact(normalized);
  if (!phrase) return [];
  const { words, grams } = queryTerms(normalized);
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
      return { result, score: relevant ? score : 0 };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ result }) => result);
}
