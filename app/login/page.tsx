import type { Metadata } from "next";
import { MemberEntry,type MemberEntryProps } from "@/components/accounts/entry";

export const metadata:Metadata={title:"用户登录",robots:{index:false,follow:false}};

export default async function Login({searchParams}:MemberEntryProps) {
  return <MemberEntry mode="login" input={await searchParams}/>;
}
