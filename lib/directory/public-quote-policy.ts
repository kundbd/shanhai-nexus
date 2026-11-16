export const storefrontPriceEvidence=`src.site_id=s.id AND p.storefront_observed=1
  AND (src.kind='official' OR (src.kind='media' AND p.reported_item_url IS NOT NULL))`;

// The source records proof for this particular quote. A merchant badge has no bearing on it.
export const publicPriceEvidence=`src.verified=1 AND ((p.storefront_observed=0
  AND (src.site_id=s.id OR src.site_id IS NULL)) OR (${storefrontPriceEvidence}))`;
