import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { seedCategories,seedDatabase } from "./seed";
import { websiteUrl } from "./validation";

export function all<T>(db: DatabaseSync, sql: string, ...args: SQLInputValue[]) {
  return db.prepare(sql).all(...args) as T[];
}
export function one<T>(db: DatabaseSync, sql: string, ...args: SQLInputValue[]) {
  return db.prepare(sql).get(...args) as T | undefined;
}
export function transaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const migrations = ["001-initial.sql","002-merchant-directory.sql","003-directory-dates.sql","004-coverage-pipelines.sql","005-merchant-submissions.sql","006-discovery.sql","007-discovery-submission-details.sql","008-deepseek-search.sql","009-merchant-campaigns.sql","010-merchant-proxy-category.sql","011-merchant-directory-indexes.sql","012-merchant-evidence-review.sql","013-merchant-source-provenance.sql","014-merchant-admission.sql","015-merchant-lead-reviews.sql","016-backlog-resolution.sql","017-merchant-domain-listings.sql","018-domain-listing-names.sql","019-directory-refresh.sql","020-merchant-storefronts.sql","021-reported-storefront-prices.sql","022-storefront-product-titles.sql","023-retire-domain-listings.sql","024-third-party-editorials.sql","025-anonymous-reviews.sql","026-review-threads.sql","027-page-traffic.sql","028-quote-precision.sql","029-merchant-avatars.sql","030-member-accounts.sql","031-community-posts.sql","032-content-moderation.sql","033-community-post-views.sql","034-unique-visitors.sql","035-automatic-directory-refresh.sql","036-ranking-visitors.sql","037-storefront-availability.sql","038-storefront-feed.sql","039-storefront-feed-checks.sql","040-retire-network-services.sql","041-merchant-submission-reviews.sql","042-import-item-reviews.sql","043-content-regions.sql","044-overseas-network-publication.sql","045-overseas-home-ads.sql"];
export function migrate(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT");
  transaction(db, () => {
    for (const name of migrations) {
      if (one(db, "SELECT 1 FROM migrations WHERE name=?", name)) continue;
      if (name === "002-merchant-directory.sql") seedCategories(db);
      db.exec(readFileSync(resolve(process.cwd(), "lib/directory/migrations", name), "utf8"));
      if (name === "002-merchant-directory.sql") {
        const update = db.prepare("UPDATE site_domains SET registrable=? WHERE domain=?");
        for (const {domain} of all<{domain:string}>(db,"SELECT domain FROM site_domains")) {
          try { update.run(websiteUrl(domain).registrable,domain); } catch { /* Retain previously accepted domains for manual review. */ }
        }
      }
      db.prepare("INSERT INTO migrations VALUES (?,?)").run(name, new Date().toISOString());
    }
  });
}

export function openDirectory(path: string, seed = true): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=4000; PRAGMA journal_mode=WAL;");
    migrate(db);
    if (seed) transaction(db, () => seedDatabase(db));
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

const state = globalThis as typeof globalThis & { shanhaiDirectory?: DatabaseSync };
export function directory() {
  return state.shanhaiDirectory ??= openDirectory(resolve(process.env.DB_PATH || "data/directory.sqlite"));
}
