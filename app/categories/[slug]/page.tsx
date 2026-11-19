import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogPage, type Params } from "@/components/directory/catalog-page";
import { getCategory } from "@/lib/directory/read";
import { categoryHref } from "@/lib/directory/types";
import { contentVisibility, universalVisibility } from "@/lib/geo/request";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{slug:string}>; searchParams: Promise<Params> };
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const visibility=await contentVisibility();
  const item=getCategory((await params).slug,undefined,visibility);
  if (!item) return {robots:{index:false,follow:false}};
  return {title:item.label,description:visibility.filterText(item.description),alternates:{canonical:categoryHref(item.slug)},
    ...(!universalVisibility().categoryAllowed(item.slug)&&{robots:{index:false,follow:false}})};
}
export default async function CategoryPage({params,searchParams}:Props) {
  const item = getCategory((await params).slug,undefined,await contentVisibility());
  if (!item) notFound();
  return <CatalogPage input={await searchParams} fixed={item}/>;
}
