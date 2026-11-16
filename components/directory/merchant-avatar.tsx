import Image from "next/image";
import type { Site } from "@/lib/directory/types";

export function MerchantAvatar({site,size=36}:{site:Pick<Site,"name"|"slug"|"avatar_digest">;size?:number}) {
  const letter=site.name.match(/[\p{L}\p{N}]/u)?.[0].toLocaleUpperCase("zh-CN")??"店";
  const image=site.avatar_digest?`/api/merchant-avatar/${site.slug}/${site.avatar_digest}`:null;
  return <span className="merchant-avatar" style={{width:size,height:size}} aria-hidden="true" data-avatar={image?"image":"initial"}>
    {image?<Image src={image} alt="" width={size} height={size} unoptimized loading={size>36?"eager":"lazy"}/>:letter}
  </span>;
}
