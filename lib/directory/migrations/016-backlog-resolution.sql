ALTER TABLE merchant_admission_decisions ADD COLUMN resolved_as TEXT
  CHECK(resolved_as IS NULL OR (outcome='lead' AND resolved_as IN ('unavailable','restricted','insufficient','redirected')));

ALTER TABLE merchant_admission_runs ADD COLUMN reviewed_run_id INTEGER REFERENCES merchant_admission_runs(id);
CREATE UNIQUE INDEX merchant_backlog_applied_once ON merchant_admission_runs(reviewed_run_id) WHERE reviewed_run_id IS NOT NULL;
CREATE INDEX merchant_admission_backlog_state ON merchant_admission_decisions(run_id,resolved_as,outcome);
