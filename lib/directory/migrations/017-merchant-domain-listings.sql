CREATE TABLE merchant_domain_listings (
  domain TEXT PRIMARY KEY COLLATE NOCASE,
  admission_run_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  published_at TEXT NOT NULL,
  FOREIGN KEY(admission_run_id,candidate_id) REFERENCES merchant_admission_decisions(run_id,candidate_id)
) STRICT;

CREATE INDEX merchant_domain_listings_source ON merchant_domain_listings(admission_run_id,candidate_id);
CREATE INDEX merchant_domain_listings_recent ON merchant_domain_listings(published_at DESC,domain);

CREATE VIEW public_merchant_domains AS
SELECT listing.* FROM merchant_domain_listings listing
WHERE NOT EXISTS (
  SELECT 1 FROM site_domains d JOIN sites s ON s.id=d.site_id
  WHERE d.registrable=listing.domain AND s.publication='published'
);
