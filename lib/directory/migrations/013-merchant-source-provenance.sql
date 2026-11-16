CREATE INDEX merchant_candidates_domain_history ON merchant_candidates(registrable,campaign_id);

CREATE TABLE merchant_source_runs (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES merchant_campaigns(id),
  source_id INTEGER NOT NULL REFERENCES discovery_sources(id),
  source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
  adapter TEXT NOT NULL,
  created_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('ok','partial','failed','restricted')),
  returned INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX merchant_source_runs_campaign ON merchant_source_runs(campaign_id,source_id,id);

CREATE TABLE merchant_source_links (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES merchant_source_runs(id),
  candidate_id INTEGER REFERENCES merchant_candidates(id),
  url TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  name_hint TEXT NOT NULL DEFAULT '',
  filter_reason TEXT NOT NULL DEFAULT '',
  UNIQUE(run_id,url,evidence_url)
) STRICT;
CREATE INDEX merchant_source_links_candidate ON merchant_source_links(candidate_id,id);

CREATE TABLE merchant_verification_attempts (
  id INTEGER PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES merchant_candidates(id),
  checked_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms>=0),
  proof_url TEXT
) STRICT;
CREATE INDEX merchant_verification_attempts_candidate ON merchant_verification_attempts(candidate_id,id);
