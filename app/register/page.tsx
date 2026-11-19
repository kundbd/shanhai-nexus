import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { MemberEntry,type MemberEntryProps } from "@/components/accounts/entry";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {title:t("注册账号"),robots:{index:false,follow:false}};
}

export default async function Register({searchParams}:MemberEntryProps) {
  return <MemberEntry mode="register" input={await searchParams}/>;
}
