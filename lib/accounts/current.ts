import { cache } from "react";
import { cookies } from "next/headers";
import { directory } from "@/lib/directory/db";
import { memberCookie,memberSession } from "./store";

export const currentMember=cache(async(verify=false)=>{
  const token=(await cookies()).get(memberCookie)?.value;
  return token?memberSession(directory(),token,{verify}).catch(()=>undefined):undefined;
});
