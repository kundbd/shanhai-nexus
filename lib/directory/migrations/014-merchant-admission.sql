CREATE TABLE merchant_admission_runs (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES merchant_campaigns(id),
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL
) STRICT;

CREATE TABLE merchant_admission_decisions (
  run_id INTEGER NOT NULL REFERENCES merchant_admission_runs(id),
  candidate_id INTEGER NOT NULL REFERENCES merchant_candidates(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('verified','basic','duplicate','conflict','excluded','lead')),
  reason TEXT NOT NULL,
  item_id INTEGER REFERENCES import_items(id),
  existing_site INTEGER REFERENCES sites(id),
  evidence TEXT CHECK(evidence IS NULL OR json_valid(evidence)),
  PRIMARY KEY(run_id,candidate_id)
) STRICT;
CREATE INDEX merchant_admission_by_item ON merchant_admission_decisions(item_id,run_id DESC);
