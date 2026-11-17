ALTER TABLE community_posts ADD COLUMN visitor_count INTEGER NOT NULL DEFAULT 0 CHECK(visitor_count>=0);

CREATE TABLE community_post_visitors (
  post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  visitor_hash BLOB NOT NULL CHECK(length(visitor_hash)=32),
  PRIMARY KEY (post_id,visitor_hash)
) WITHOUT ROWID, STRICT;

CREATE TABLE traffic_visitors (
  page TEXT NOT NULL CHECK(length(page)<=120 AND (page='' OR substr(page,1,1)='/')),
  visitor_hash BLOB NOT NULL CHECK(length(visitor_hash)=32),
  last_seen INTEGER NOT NULL CHECK(last_seen>=0),
  PRIMARY KEY (page,visitor_hash)
) WITHOUT ROWID, STRICT;
CREATE INDEX traffic_visitors_recent ON traffic_visitors(last_seen);
