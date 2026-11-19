import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { MemberEntry,type MemberEntryProps } from "@/components/accounts/entry";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {title:t("用户登录"),robots:{index:false,follow:false}};
}

export default async function Login({searchParams}:MemberEntryProps) {
  return <MemberEntry mode="login" input={await searchParams}/>;
}
