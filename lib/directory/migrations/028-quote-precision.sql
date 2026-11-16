ALTER TABLE price_records ADD COLUMN amount_scale INTEGER CHECK(amount_scale BETWEEN 0 AND 6);
