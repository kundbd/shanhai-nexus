import type { Metadata } from "next";
import { MemberEntry,type MemberEntryProps } from "@/components/accounts/entry";

export const metadata:Metadata={title:"注册账号",robots:{index:false,follow:false}};

export default async function Register({searchParams}:MemberEntryProps) {
  return <MemberEntry mode="register" input={await searchParams}/>;
}
