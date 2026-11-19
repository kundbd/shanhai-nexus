import { publicCategorySlug } from "./taxonomy";

export const statuses = { listed: "资料待核实", verified: "资料已核实", tested: "站方已实测" } as const;
export const natures = { official: "官方公开资料", tested: "站方实测", media: "第三方公开报道", user: "用户报告", pending: "待核实" } as const;
export const editorialOrigins = { editorial: "山海观察", third_party: "第三方测评" } as const;
export const incidentLabels = { price: "价格调整", policy: "政策变更", status: "服务状态", other: "重要事件" } as const;
export type Status = keyof typeof statuses;
export type Nature = keyof typeof natures;
export type Publication = "draft" | "published" | "archived";
export type Category = { slug: string; label: string; description: string; parent_slug: string | null; position: number };
export type Site = {
  id: number; slug: string; name: string; website: string; domain: string; category_slug: string; category_label: string;
  summary: string; aliases: string; contact: string | null; products: string | null; payments: string | null;
  fees: string | null; renewal: string | null; refunds: string | null; regions: string | null;
  status: Status; publication: Publication; added_at: string; updated_at: string; verified_at: string | null; review_count: number;
  operator_kind:keyof typeof operators; lifecycle:keyof typeof lifecycleLabels; reachability:keyof typeof reachabilityLabels;
  checked_at:string|null; merchant_details:string;
  basis:"standard"|"basic"|"official";
  website_language:string|null;
  avatar_digest:string|null;
  hosted_storefront:0|1;
  has_public_prices:0|1;
  product_observed_at:string|null;
};
export type Source = { id: number; site_id: number | null; title: string; url: string; accessed_at: string; kind: Nature; verified: number; excerpt: string; digest: string; attribution:string|null; license_url:string|null };
export type Editorial = { id: number; slug: string; site_id: number | null; title: string; summary: string; body: string; publication: Publication; updated_at: string; origin: keyof typeof editorialOrigins };
export type Claim = { id: number; editorial_id: number; label: string; statement: string; nature: Nature; source_id: number | null };
export type Price = { id: number; site_id: number; source_id: number; plan: string; amount_minor: number; amount_scale?:number|null; currency: string; period: string; region: string; notes: string; recorded_at: string; publication: Publication; source_url: string; source_title: string; storefront_observed: 0 | 1; reported_item_url:string|null; product_title:string|null };
export type Incident = { id: number; site_id: number; source_id: number; title: string; summary: string; kind: keyof typeof incidentLabels; occurred_at: string; publication: Publication; source_url: string; site_name: string; site_slug: string };
export type ImportItem = { id: number; batch_id: number; payload: string; domain: string | null; state: "ready" | "failed" | "duplicate" | "approved" | "published"; message: string; site_id: number | null;
  registrable:string|null; normalized_name:string|null; reachability:Site["reachability"]; checked_at:string|null; check_detail:string; final_url:string|null };
export type Submission = { id: number; site_id: number | null; kind: "site" | "correction" | "response"; url: string | null; body: string; submitted_at: string; moderation: "pending" | "accepted" | "rejected"; review_note: string };

export const siteHref = (slug: string) => `/services/${slug}`;
export const categoryHref = (slug: string) => `/categories/${publicCategorySlug(slug)}`;
export const observationHref = (slug: string) => `/observations/${slug}`;
export const noData = "暂无数据";
import type { lifecycleLabels,operators,reachabilityLabels } from "./taxonomy";

