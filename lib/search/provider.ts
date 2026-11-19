import { resultLabels, searchCatalog, type ResultKind, type SearchResult } from "./index";

export interface SearchService {
  search(query: string, kind?: ResultKind, visible?: (result: SearchResult)=>boolean): Promise<readonly SearchResult[]>;
}

/** Optional local semantic/model adapter. Every result is a candidate ID. */
export interface AISearchProvider {
  rank(input: {
    readonly query: string;
    readonly candidates: readonly Pick<SearchResult, "id" | "title" | "description">[];
    readonly signal: AbortSignal;
  }): Promise<readonly string[]>;
}

export function createSearchService(provider?: AISearchProvider, timeoutMs = 350): SearchService {
  let busy = false;
  return {
    async search(query, kind, visible) {
      const base = searchCatalog(query, kind, visible);
      if (!provider || busy || base.length < 2) return base;
      const candidates = base.slice(0, 12).map(({ id, title, description }) => ({ id, title, description }));
      const allowed = new Set(candidates.map(({ id }) => id));
      const abort = new AbortController();
      busy = true;
      const ranking = Promise.resolve().then(() => provider.rank({ query, candidates, signal: abort.signal }))
        .finally(() => { busy = false; });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const ids = await Promise.race([ranking, new Promise<readonly string[]>((resolve) => {
          timeout = setTimeout(() => { abort.abort(); resolve([]); }, timeoutMs);
        })]);
        const positions = new Map([...new Set(ids)].filter((id) => allowed.has(id)).map((id, i) => [id, i]));
        return [...base].sort((left, right) => (positions.get(left.id) ?? Infinity) - (positions.get(right.id) ?? Infinity));
      } catch {
        return base;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export const searchService = createSearchService();
export const resultKinds = Object.keys(resultLabels) as ResultKind[];
