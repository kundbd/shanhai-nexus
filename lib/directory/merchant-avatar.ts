import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { one } from "./db";
import { siteVisibility, type ContentVisibility } from "../geo/visibility";

export type AvatarType = "image/webp" | "image/x-icon";
export type AvatarImage = { sourceUrl:string; contentType:AvatarType; image:Uint8Array };
export type AvatarTarget = {id:number;website:string;name:string;slug:string;hosted_storefront:0|1};

export function saveMerchantAvatar(db:DatabaseSync,site:Pick<AvatarTarget,"id"|"website">,result:AvatarImage|null,reason:string,checkedAt:string) {
  const digest=result?createHash("sha256").update(result.image).digest("hex"):null;
  db.prepare(`INSERT INTO merchant_avatars (site_id,website,source_url,content_type,image,digest,checked_at,reason)
    SELECT id,website,?,?,?,?,?,? FROM sites WHERE id=? AND website=? AND publication='published'
    ON CONFLICT(site_id) DO UPDATE SET website=excluded.website,source_url=excluded.source_url,
      content_type=excluded.content_type,image=excluded.image,digest=excluded.digest,checked_at=excluded.checked_at,reason=excluded.reason
    WHERE (merchant_avatars.image IS NULL OR excluded.image IS NOT NULL OR merchant_avatars.website<>excluded.website)
      AND merchant_avatars.checked_at<=excluded.checked_at`)
    .run(result?.sourceUrl??null,result?.contentType??null,result?.image??null,digest,checkedAt,reason,site.id,site.website);
}

export function findMerchantAvatar(db:DatabaseSync,slug:string,digest:string,visibility?:ContentVisibility) {
  const region=siteVisibility(visibility);
  return one<{image:Uint8Array;content_type:AvatarType}>(db,`SELECT a.image,a.content_type
    FROM merchant_avatars a JOIN sites s ON s.id=a.site_id AND s.website=a.website
    WHERE s.slug=? AND s.publication='published' AND a.digest=? AND ${region.clause}`,slug,digest,...region.bindings);
}
