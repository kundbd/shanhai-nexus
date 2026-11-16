import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogPage, type Params } from "@/components/directory/catalog-page";
import { getCategory } from "@/lib/directory/read";
import { categoryHref } from "@/lib/directory/types";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{slug:string}>; searchParams: Promise<Params> };
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const item = getCategory((await params).slug);
  return item ? {title:item.label,description:item.description,alternates:{canonical:categoryHref(item.slug)}} : {};
}
export default async function CategoryPage({params,searchParams}:Props) {
  const item = getCategory((await params).slug);
  if (!item) notFound();
  return <CatalogPage input={await searchParams} fixed={item}/>;
}
