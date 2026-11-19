-- Public quotes, products, observations, and reviews follow their site's publication state.
INSERT INTO audit_log(actor,action,entity,entity_id,before_json,after_json,created_at)
SELECT '目录维护','archive','sites',CAST(id AS TEXT),
  json_object('slug',slug,'publication','published'), json_object('slug',slug,'publication','archived'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM sites WHERE publication='published'
  AND (category_slug IN ('airport','vpn','proxy-services','residential') OR slug='tailscale');

UPDATE sites SET publication='archived'
WHERE publication='published' AND (category_slug IN ('airport','vpn','proxy-services','residential') OR slug='tailscale');

UPDATE categories SET description='云服务器与网络基础设施' WHERE slug='network';
UPDATE categories SET description='DNS、CDN 和网站基础设施' WHERE slug='network-infrastructure';

UPDATE discovery_sources SET enabled=0 WHERE pipeline='connections';
UPDATE directory_refresh_sources SET state='skipped',error='此采集分类已下架'
WHERE state='pending' AND source_id IN (SELECT id FROM discovery_sources WHERE pipeline='connections');
UPDATE directory_refresh_leads SET checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),result='review',reason='此采集分类已下架'
WHERE checked_at IS NULL AND pipeline='connections';
UPDATE directory_refresh_targets SET checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),result='skipped',reason='档案已下架'
WHERE checked_at IS NULL AND site_id IN (
  SELECT id FROM sites WHERE category_slug IN ('airport','vpn','proxy-services','residential') OR slug='tailscale'
);

CREATE TRIGGER retired_network_site_insert BEFORE INSERT ON sites
WHEN NEW.publication='published'
  AND (NEW.category_slug IN ('airport','vpn','proxy-services','residential') OR NEW.slug='tailscale')
BEGIN
  SELECT RAISE(ABORT,'此服务已下架，无法发布');
END;

CREATE TRIGGER retired_network_site_update BEFORE UPDATE OF publication,category_slug,slug ON sites
WHEN NEW.publication='published'
  AND (NEW.category_slug IN ('airport','vpn','proxy-services','residential') OR NEW.slug='tailscale')
BEGIN
  SELECT RAISE(ABORT,'此服务已下架，无法发布');
END;
