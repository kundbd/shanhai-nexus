import type { Metadata } from "next";
import { CatalogPage, type Params } from "@/components/directory/catalog-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title:"服务目录",description:"按分类、域名和公开报价查找数字服务商档案。",alternates:{canonical:"/services"} };

export default async function Services({ searchParams }: { searchParams: Promise<Params> }) {
  return <CatalogPage input={await searchParams}/>;
}
