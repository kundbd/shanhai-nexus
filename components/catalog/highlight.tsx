import { canonicalize, queryTerms } from "@/lib/search/query";

export function Highlight({ value, query }: { value: string; query: string }) {
  const terms = new Set([query.trim(), ...queryTerms(query.toLowerCase()).words, ...queryTerms(canonicalize(query)).words]);
  const pattern = [...terms].filter((term) => term.length >= 2).sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (!pattern) return value;
  return value.split(new RegExp(`(${pattern})`, "giu")).map((part, i) => i % 2 ? <mark key={i}>{part}</mark> : part);
}
