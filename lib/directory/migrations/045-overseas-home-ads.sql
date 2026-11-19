-- Restore the original network ads through the existing overseas visibility policy.
INSERT OR IGNORE INTO content_region_rules(kind,content_key,mode,updated_at) VALUES
  ('ad','flowercloud','overseas',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ad','liangxin-yun','overseas',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('promotion','https://api-flowercloud.com/aff.php?aff=27838','overseas',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('promotion','https://xn--9kqz23b19z.com/#/register?code=pdILA0Yi','overseas',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
