CREATE TABLE merchant_campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'paused' CHECK(state IN ('running','paused','blocked')),
  budget_milli INTEGER NOT NULL CHECK(budget_milli BETWEEN 5 AND 10000),
  pause_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE merchant_queries (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES merchant_campaigns(id),
  provider TEXT NOT NULL,
  pipeline TEXT NOT NULL CHECK(pipeline IN ('ai-retail','ai-relay','connections','payments','vps')),
  family TEXT NOT NULL,
  query TEXT NOT NULL,
  priority INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','done','failed')),
  lease_until TEXT NOT NULL DEFAULT '',
  available_at TEXT NOT NULL DEFAULT '',
  UNIQUE(provider,query)
) STRICT;
CREATE INDEX merchant_queries_queue ON merchant_queries(campaign_id,state,pipeline,available_at,priority,id);

CREATE TABLE merchant_requests (
  id INTEGER PRIMARY KEY,
  query_id INTEGER NOT NULL REFERENCES merchant_queries(id),
  campaign_id INTEGER NOT NULL REFERENCES merchant_campaigns(id),
  unit_milli INTEGER NOT NULL CHECK(unit_milli>0),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','billable','empty','failed','uncertain')),
  returned INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX merchant_requests_budget ON merchant_requests(campaign_id,id);
CREATE INDEX merchant_requests_retry ON merchant_requests(query_id,id);

CREATE TABLE merchant_candidates (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES merchant_campaigns(id),
  registrable TEXT NOT NULL,
  pipeline TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','checking','known','filtered','unverified','manual','ready','rejected')),
  lease_until TEXT NOT NULL DEFAULT '',
  checked_at TEXT,
  reason TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details)),
  item_id INTEGER REFERENCES import_items(id),
  UNIQUE(campaign_id,registrable)
) STRICT;
CREATE INDEX merchant_candidates_queue ON merchant_candidates(campaign_id,state,pipeline,id);

CREATE TABLE merchant_urls (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES merchant_requests(id),
  candidate_id INTEGER REFERENCES merchant_candidates(id),
  url TEXT NOT NULL,
  filter_reason TEXT NOT NULL DEFAULT '',
  UNIQUE(request_id,url)
) STRICT;
CREATE INDEX merchant_urls_by_candidate ON merchant_urls(candidate_id,id);

CREATE TABLE merchant_site_tags (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  source_url TEXT NOT NULL,
  PRIMARY KEY(site_id,tag)
) STRICT;
