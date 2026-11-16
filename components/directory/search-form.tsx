import { Search } from "lucide-react";

export function PublicSearch({ q = "", action = "/search" }: { q?: string; action?: string }) {
  return <form action={action} role="search" className="public-search">
    <Search size={19} aria-hidden="true" /><input key={q} type="search" name="q" maxLength={160} defaultValue={q} aria-label="搜索服务商、域名或关键词" placeholder="搜索服务商、域名或关键词" autoComplete="off" />
    <button type="submit" className="button primary">搜索</button>
  </form>;
}
