CREATE TABLE page_traffic (
  minute INTEGER NOT NULL CHECK(minute >= 0),
  page TEXT NOT NULL CHECK(length(page) BETWEEN 1 AND 120 AND substr(page,1,1)='/'),
  views INTEGER NOT NULL CHECK(views > 0),
  PRIMARY KEY (minute,page)
) WITHOUT ROWID, STRICT;
