ALTER TABLE merchant_domain_listings ADD COLUMN website_name TEXT
  CHECK(website_name IS NULL OR length(website_name) BETWEEN 2 AND 64);
ALTER TABLE merchant_domain_listings ADD COLUMN name_source_url TEXT
  CHECK((website_name IS NULL)=(name_source_url IS NULL));
