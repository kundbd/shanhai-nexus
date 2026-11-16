CREATE TABLE discovery_sources (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  pipeline TEXT NOT NULL CHECK(pipeline IN ('ai-retail','ai-relay','connections','payments','vps')),
  kind TEXT NOT NULL CHECK(kind IN ('brave','page','sitemap','dataset','manual')),
  access TEXT NOT NULL CHECK(access IN ('licensed','official','leads','restricted')),
  url TEXT NOT NULL, evidence_url TEXT NOT NULL, notes TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  interval_hours INTEGER NOT NULL CHECK(interval_hours BETWEEN 1 AND 720),
  next_run_at TEXT NOT NULL, updated_at TEXT NOT NULL, query_cursor INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX discovery_schedule ON discovery_sources(enabled,next_run_at);
CREATE TABLE discovery_jobs (
  id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES discovery_sources(id) ON DELETE RESTRICT,
  source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
  state TEXT NOT NULL CHECK(state IN ('queued','running','ok','partial','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, token TEXT,
  received INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0, candidates INTEGER NOT NULL DEFAULT 0,
  held INTEGER NOT NULL DEFAULT 0, errors TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(errors)),
  batch_id INTEGER REFERENCES import_batches(id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX discovery_one_pending ON discovery_jobs(source_id) WHERE state IN ('queued','running');
CREATE INDEX discovery_queue ON discovery_jobs(state,available_at,id);
CREATE TABLE discovery_hits (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES discovery_jobs(id) ON DELETE RESTRICT,
  url TEXT NOT NULL, domain TEXT NOT NULL, registrable TEXT NOT NULL, evidence_url TEXT NOT NULL, query TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('candidate','held','known','duplicate')), reason TEXT NOT NULL,
  UNIQUE(job_id,url,query)
) STRICT;
CREATE INDEX discovery_hits_domain ON discovery_hits(registrable,decision);
ALTER TABLE sites ADD COLUMN website_language TEXT;
