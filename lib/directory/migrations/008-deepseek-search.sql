CREATE TABLE discovery_sources_next (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  pipeline TEXT NOT NULL CHECK(pipeline IN ('ai-retail','ai-relay','connections','payments','vps')),
  kind TEXT NOT NULL CHECK(kind IN ('brave','deepseek','page','sitemap','dataset','manual')),
  access TEXT NOT NULL CHECK(access IN ('licensed','official','leads','restricted')),
  url TEXT NOT NULL, evidence_url TEXT NOT NULL, notes TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  interval_hours INTEGER NOT NULL CHECK(interval_hours BETWEEN 1 AND 720),
  next_run_at TEXT NOT NULL, updated_at TEXT NOT NULL, query_cursor INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE discovery_jobs_next (
  id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES discovery_sources_next(id) ON DELETE RESTRICT,
  source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
  state TEXT NOT NULL CHECK(state IN ('queued','running','ok','partial','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, token TEXT,
  received INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0, candidates INTEGER NOT NULL DEFAULT 0,
  held INTEGER NOT NULL DEFAULT 0, errors TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(errors)),
  batch_id INTEGER REFERENCES import_batches(id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE discovery_hits_next (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES discovery_jobs_next(id) ON DELETE RESTRICT,
  url TEXT NOT NULL, domain TEXT NOT NULL, registrable TEXT NOT NULL, evidence_url TEXT NOT NULL, query TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('candidate','held','known','duplicate')), reason TEXT NOT NULL,
  UNIQUE(job_id,url,query)
) STRICT;

INSERT INTO discovery_sources_next SELECT * FROM discovery_sources;
INSERT INTO discovery_jobs_next SELECT * FROM discovery_jobs;
INSERT INTO discovery_hits_next SELECT * FROM discovery_hits;
DROP TABLE discovery_hits;
DROP TABLE discovery_jobs;
DROP TABLE discovery_sources;
ALTER TABLE discovery_sources_next RENAME TO discovery_sources;
ALTER TABLE discovery_jobs_next RENAME TO discovery_jobs;
ALTER TABLE discovery_hits_next RENAME TO discovery_hits;
CREATE INDEX discovery_schedule ON discovery_sources(enabled,next_run_at);
CREATE UNIQUE INDEX discovery_one_pending ON discovery_jobs(source_id) WHERE state IN ('queued','running');
CREATE INDEX discovery_queue ON discovery_jobs(state,available_at,id);
CREATE INDEX discovery_hits_domain ON discovery_hits(registrable,decision);

CREATE TABLE deepseek_search_usage (
  day TEXT PRIMARY KEY,
  requests INTEGER NOT NULL CHECK(requests BETWEEN 1 AND 100)
) STRICT;
