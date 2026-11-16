CREATE INDEX source_verification_by_site ON sources(site_id,kind,verified);
CREATE INDEX public_sites_by_name ON sites(publication,name COLLATE NOCASE,id);
CREATE INDEX merchant_candidates_identity ON merchant_candidates(campaign_id,json_extract(details,'$.identity'),json_extract(details,'$.name'))
WHERE state IN ('ready','manual');
