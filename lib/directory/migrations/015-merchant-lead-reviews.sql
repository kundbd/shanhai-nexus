CREATE TABLE merchant_lead_reviews (
  admission_run_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  lease_until TEXT NOT NULL DEFAULT '',
  checked_at TEXT,
  outcome TEXT CHECK(outcome IN ('existing','merchant','possible','non_merchant','redirect','restricted','unavailable','insufficient')),
  reason TEXT NOT NULL DEFAULT '',
  proof_url TEXT,
  pages TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(pages)),
  evidence TEXT CHECK(evidence IS NULL OR json_valid(evidence)),
  existing_site INTEGER REFERENCES sites(id),
  PRIMARY KEY(admission_run_id,candidate_id),
  FOREIGN KEY(admission_run_id,candidate_id) REFERENCES merchant_admission_decisions(run_id,candidate_id),
  CHECK((outcome IS NULL)=(checked_at IS NULL))
) STRICT;

CREATE INDEX merchant_lead_reviews_queue ON merchant_lead_reviews(admission_run_id,outcome,lease_until,candidate_id);
