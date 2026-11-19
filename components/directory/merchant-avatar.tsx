import Image from "next/image";
import { Store } from "lucide-react";
import { officialAiProduct } from "@/lib/directory/ai-product";
import type { Site } from "@/lib/directory/types";
import { AiProductIcon } from "./ai-product-icon";
import { categoryIcons } from "./category-icon";

export function MerchantAvatar({site,size=36}:{site:Pick<Site,"category_slug"|"slug"|"avatar_digest">;size?:number}) {
  const image=site.avatar_digest?`/api/merchant-avatar/${site.slug}/${site.avatar_digest}`:null;
  const brand=site.category_slug==="ai-subscriptions"?officialAiProduct(site.slug):undefined;
  const category=site.category_slug;
  const Icon=Object.hasOwn(categoryIcons,category)?categoryIcons[category as keyof typeof categoryIcons]:Store;
  const fallback=<Icon size={Math.round(size*.52)} />;
  return <span className="merchant-avatar" style={{width:size,height:size}} aria-hidden="true" data-avatar={image?"image":brand?"brand":"category"}>
    {image?<Image className="merchant-avatar-image" src={image} alt="" width={size} height={size} unoptimized loading={size>36?"eager":"lazy"}/>
      :<AiProductIcon product={brand??""} fallback={fallback}/>}
  </span>;
}
