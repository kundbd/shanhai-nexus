CREATE TABLE ranking_pages (
  id INTEGER PRIMARY KEY,
  page TEXT NOT NULL UNIQUE CHECK(length(page)<=120 AND (page GLOB '/services/?*' OR page GLOB '/products/?*')),
  visitors INTEGER NOT NULL DEFAULT 0 CHECK(visitors>=0)
) STRICT;

CREATE TABLE ranking_visitors (
  page_id INTEGER NOT NULL REFERENCES ranking_pages(id) ON DELETE CASCADE,
  visitor_hash BLOB NOT NULL CHECK(length(visitor_hash)=32),
  PRIMARY KEY (page_id,visitor_hash)
) WITHOUT ROWID, STRICT;

CREATE TRIGGER ranking_visitor_added AFTER INSERT ON ranking_visitors
BEGIN
  UPDATE ranking_pages SET visitors=visitors+1 WHERE id=new.page_id;
END;

CREATE TRIGGER ranking_visitor_removed AFTER DELETE ON ranking_visitors
BEGIN
  UPDATE ranking_pages SET visitors=visitors-1 WHERE id=old.page_id;
END;

INSERT INTO ranking_pages(page)
SELECT DISTINCT page FROM traffic_visitors
WHERE (page GLOB '/services/?*' OR page GLOB '/products/?*')
  AND last_seen>CAST(unixepoch()/60 AS INTEGER)-1440 AND last_seen<=CAST(unixepoch()/60 AS INTEGER);

INSERT INTO ranking_visitors(page_id,visitor_hash)
SELECT p.id,v.visitor_hash FROM ranking_pages p JOIN traffic_visitors v ON v.page=p.page
WHERE v.last_seen>CAST(unixepoch()/60 AS INTEGER)-1440 AND v.last_seen<=CAST(unixepoch()/60 AS INTEGER);
