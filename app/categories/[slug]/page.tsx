import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CatalogPage, type Params } from "@/components/directory/catalog-page";
import { getCategory, publicCategoryAllowed } from "@/lib/directory/read";
import { categoryHref } from "@/lib/directory/types";
import { contentVisibility, universalVisibility } from "@/lib/geo/request";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{slug:string}>; searchParams: Promise<Params> };
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const visibility=await contentVisibility();
  const item=getCategory((await params).slug,undefined,visibility);
  if (!item) return {robots:{index:false,follow:false}};
  const t = await getTranslations();
  return {title:t(item.label),description:t(visibility.filterText(item.description)),alternates:{canonical:categoryHref(item.slug)},
    ...(!publicCategoryAllowed(item.slug,universalVisibility())&&{robots:{index:false,follow:false}})};
}
export default async function CategoryPage({params,searchParams}:Props) {
  const {slug}=await params;
  const item = getCategory(slug,undefined,await contentVisibility());
  if (!item) notFound();
  const input=await searchParams;
  if (slug!==item.slug) {
    const query=new URLSearchParams();
    for (const [name,value] of Object.entries(input)) {
      for (const term of typeof value==="string" ? [value] : value??[]) query.append(name,term);
    }
    redirect(categoryHref(item.slug)+(query.size ? `?${query}` : ""));
  }
  return <CatalogPage input={input} fixed={item}/>;
}
