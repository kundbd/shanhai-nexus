import type { DatabaseSync } from "node:sqlite";
import { one,transaction } from "./db";
import { audit } from "./write";
import { now } from "./validation";

type Identity = { slug:string; name:string; aliases:string; publication:string };

export function mergeSites(db:DatabaseSync,from:number,into:number,actor:string) {
  if (from===into) throw new Error("请选择两个不同的档案。");
  return transaction(db,()=>{
    const source=one<Identity>(db,"SELECT slug,name,aliases,publication FROM sites WHERE id=?",from);
    const target=one<Identity>(db,"SELECT slug,name,aliases,publication FROM sites WHERE id=?",into);
    const hasIdentity=(id:number)=>one(db,`SELECT 1 FROM site_domains WHERE site_id=? AND kind='primary'
      UNION ALL SELECT 1 FROM merchant_storefronts WHERE site_id=? LIMIT 1`,id,id);
    if (!source || !target || !hasIdentity(from) || !hasIdentity(into)) throw new Error("档案不存在或已合并。");
    if (source.publication==="published" && target.publication!=="published") throw new Error("已发布档案须并入另一个已发布档案。");
    const aliases=[...new Set([...JSON.parse(target.aliases),source.name,...JSON.parse(source.aliases)])].filter(name=>name!==target.name);
    db.prepare("UPDATE site_domains SET site_id=?,kind=CASE WHEN kind='primary' THEN 'historical' ELSE kind END WHERE site_id=?").run(into,from);
    db.prepare("UPDATE merchant_storefronts SET site_id=? WHERE site_id=?").run(into,from);
    db.prepare(`UPDATE user_reviews AS source SET site_id=? WHERE site_id=? AND thread_id IS NULL AND NOT EXISTS
      (SELECT 1 FROM user_reviews target WHERE target.site_id=? AND target.thread_id IS NULL
        AND (target.visitor_hash=source.visitor_hash OR target.account_id=source.account_id))`).run(into,from,into);
    db.prepare(`UPDATE user_reviews SET site_id=? WHERE site_id=? AND thread_id IN
      (SELECT id FROM user_reviews WHERE site_id=? AND thread_id IS NULL)`).run(into,from,into);
    for (const table of ["sources","editorials","price_records","incidents","submissions","import_items","site_redirects"]) {
      db.prepare(`UPDATE ${table} SET site_id=? WHERE site_id=?`).run(into,from);
    }
    db.prepare("INSERT OR IGNORE INTO merchant_site_tags SELECT ?,tag,source_url FROM merchant_site_tags WHERE site_id=?").run(into,from);
    db.prepare("DELETE FROM merchant_site_tags WHERE site_id=?").run(from);
    db.prepare("INSERT INTO site_redirects(old_slug,site_id) VALUES (?,?)").run(source.slug,into);
    db.prepare("UPDATE sites SET aliases=?,updated_at=? WHERE id=?").run(JSON.stringify(aliases),now(),into);
    db.prepare("UPDATE sites SET publication='archived',updated_at=? WHERE id=?").run(now(),from);
    audit(db,actor,"merge","sites",from,source,{target:into,slug:target.slug});
  });
}
