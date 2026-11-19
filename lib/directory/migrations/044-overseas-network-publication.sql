-- Limit restoration to entries archived by the original site-wide network retirement.
CREATE TEMP TABLE geo_network_reopen AS
SELECT DISTINCT s.id, s.slug, s.category_slug
FROM audit_log retirement
JOIN sites s ON s.id=CAST(retirement.entity_id AS INTEGER)
WHERE retirement.entity='sites' AND retirement.action='archive' AND retirement.actor='目录维护'
  AND retirement.before_json=json_object('slug',s.slug,'publication','published')
  AND retirement.after_json=json_object('slug',s.slug,'publication','archived')
  AND s.publication='archived'
  AND (s.category_slug IN ('airport','vpn','proxy-services','residential') OR s.slug='tailscale')
  AND NOT EXISTS (
    SELECT 1 FROM audit_log later
    WHERE later.id>retirement.id AND (
      (later.entity='sites' AND later.entity_id=retirement.entity_id)
      OR (later.entity='content_region_rules' AND later.entity_id IN ('site:'||s.slug,'category:'||s.category_slug))
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM content_region_rules r
    WHERE ((r.kind='site' AND r.content_key=s.slug)
      OR (r.kind='category' AND r.content_key=s.category_slug
        AND s.category_slug IN ('airport','vpn','proxy-services','residential')))
      AND NOT EXISTS (
        SELECT 1 FROM content_region_overseas o WHERE o.kind=r.kind AND o.content_key=r.content_key
      )
  );

INSERT OR IGNORE INTO content_region_rules(kind,content_key,mode,updated_at)
SELECT 'category',category_slug,'overseas',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM geo_network_reopen
WHERE category_slug IN ('airport','vpn','proxy-services','residential')
GROUP BY category_slug;

INSERT OR IGNORE INTO content_region_rules(kind,content_key,mode,updated_at)
SELECT 'site',slug,'overseas',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM geo_network_reopen;

UPDATE sites SET publication='published'
WHERE id IN (SELECT id FROM geo_network_reopen);

INSERT INTO audit_log(actor,action,entity,entity_id,before_json,after_json,created_at)
SELECT '地区设置','publish','sites',CAST(id AS TEXT),
  json_object('slug',slug,'publication','archived'),
  json_object('slug',slug,'publication','published','mode','overseas'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM geo_network_reopen;

DROP TABLE geo_network_reopen;
