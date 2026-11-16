CREATE TABLE coverage_runs (
  id INTEGER PRIMARY KEY,
  pipeline TEXT NOT NULL CHECK(pipeline IN ('ai-retail','ai-relay','connections','payments','vps')),
  source_name TEXT NOT NULL, source_url TEXT NOT NULL, evidence_url TEXT NOT NULL,
  access TEXT NOT NULL CHECK(access IN ('licensed','official','submission','restricted')),
  advertised INTEGER CHECK(advertised IS NULL OR advertised>=0),
  discovered INTEGER NOT NULL CHECK(discovered>=0),
  blocked INTEGER CHECK(blocked IS NULL OR blocked>=0),
  reason TEXT NOT NULL, collected_at TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE,
  batch_id INTEGER REFERENCES import_batches(id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX coverage_group ON coverage_runs(pipeline,collected_at DESC,id DESC);
ALTER TABLE sites ADD COLUMN basis TEXT NOT NULL DEFAULT 'standard' CHECK(basis IN ('standard','basic','official'));
