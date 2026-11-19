import Link from "next/link";
import { brand } from "@/lib/brand";

export function Brand({ homeLabel }: { homeLabel: string }) {
  return (
    <Link href="/" className="brand" aria-label={`${brand.name} ${brand.english} ${homeLabel}`}>
      <span className="brand-type"><strong>{brand.name}</strong><span>{brand.english}</span></span>
    </Link>
  );
}
