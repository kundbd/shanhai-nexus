import Link from "next/link";
import { brand } from "@/lib/brand";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label={`${brand.name} ${brand.english} 首页`}>
      <span className="brand-type"><strong>{brand.name}</strong><span>{brand.english}</span></span>
    </Link>
  );
}
