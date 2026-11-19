ALTER TABLE directory_refresh_runs ADD COLUMN automatic_discovery INTEGER NOT NULL DEFAULT 0 CHECK(automatic_discovery IN (0,1));

CREATE TABLE directory_refresh_sources (
  run_id INTEGER NOT NULL REFERENCES directory_refresh_runs(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES discovery_sources(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','collected','failed','skipped')),
  error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(run_id,source_id)
) STRICT;
CREATE INDEX directory_refresh_source_history ON directory_refresh_sources(source_id,run_id DESC);

CREATE TABLE directory_refresh_leads (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES directory_refresh_runs(id) ON DELETE CASCADE,
  identity TEXT NOT NULL,
  pipeline TEXT NOT NULL CHECK(pipeline IN ('ai-retail','ai-relay','connections','payments','vps')),
  url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  found_at TEXT NOT NULL,
  checked_at TEXT,
  result TEXT CHECK(result IN ('published','updated','known','restricted','unreachable','needs_evidence','review','error')),
  evidence_url TEXT,
  reason TEXT NOT NULL DEFAULT '',
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  quotes_checked INTEGER NOT NULL DEFAULT 0,
  quotes_changed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(run_id,identity)
) STRICT;
CREATE INDEX directory_refresh_leads_pending ON directory_refresh_leads(run_id,checked_at,id);
CREATE INDEX directory_refresh_leads_history ON directory_refresh_leads(identity,id DESC);
