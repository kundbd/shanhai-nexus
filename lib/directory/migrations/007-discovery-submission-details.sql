ALTER TABLE submissions ADD COLUMN merchant_contact TEXT;
ALTER TABLE submissions ADD COLUMN merchant_offers TEXT;
ALTER TABLE submissions ADD COLUMN merchant_operations TEXT;
ALTER TABLE submissions ADD COLUMN merchant_registrable TEXT;
CREATE INDEX submission_merchant_domain ON submissions(merchant_registrable,moderation);
