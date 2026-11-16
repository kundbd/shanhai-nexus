ALTER TABLE merchant_domain_listings ADD COLUMN checked_at TEXT;
ALTER TABLE merchant_domain_listings ADD COLUMN reachability TEXT NOT NULL DEFAULT 'unchecked'
  CHECK(reachability IN ('unchecked','reachable','restricted','unreachable','skipped','inconclusive'));

CREATE TABLE directory_refresh_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  lease_until TEXT NOT NULL DEFAULT '',
  token TEXT,
  targets INTEGER NOT NULL DEFAULT 0,
  reachable INTEGER NOT NULL DEFAULT 0,
  restricted INTEGER NOT NULL DEFAULT 0,
  unconfirmed INTEGER NOT NULL DEFAULT 0,
  quotes_checked INTEGER NOT NULL DEFAULT 0,
  quotes_changed INTEGER NOT NULL DEFAULT 0,
  search_state TEXT NOT NULL DEFAULT 'pending' CHECK(search_state IN ('pending','reserved','done','empty','skipped','failed','uncertain')),
  search_query TEXT NOT NULL DEFAULT '',
  search_urls TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(search_urls)),
  search_reserved_milli INTEGER NOT NULL DEFAULT 0,
  search_billable_milli INTEGER NOT NULL DEFAULT 0,
  search_error TEXT NOT NULL DEFAULT '',
  rate_state TEXT NOT NULL DEFAULT 'pending' CHECK(rate_state IN ('pending','ok','failed')),
  rate_day TEXT,
  rate_error TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE UNIQUE INDEX directory_refresh_active ON directory_refresh_runs((1)) WHERE finished_at IS NULL;

CREATE TABLE directory_refresh_targets (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES directory_refresh_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('price','site','domain')),
  site_id INTEGER,
  domain TEXT,
  url TEXT NOT NULL,
  checked_at TEXT,
  result TEXT CHECK(result IN ('reachable','restricted','unreachable','skipped','inconclusive','needs_evidence')),
  evidence_url TEXT,
  reason TEXT NOT NULL DEFAULT '',
  quotes_checked INTEGER NOT NULL DEFAULT 0,
  quotes_changed INTEGER NOT NULL DEFAULT 0,
  CHECK((kind='domain' AND domain IS NOT NULL AND site_id IS NULL) OR (kind<>'domain' AND site_id IS NOT NULL AND domain IS NULL))
) STRICT;
CREATE INDEX directory_refresh_items ON directory_refresh_targets(run_id,checked_at,id);

CREATE TABLE directory_exchange_rates (
  rate_day TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(length(currency)=3),
  per_eur REAL NOT NULL CHECK(per_eur>0),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(rate_day,currency)
) STRICT;
