"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function CampaignRefresh() {
  const router=useRouter();
  useEffect(()=>{
    const timer=setInterval(()=>{ if (document.visibilityState==="visible") router.refresh(); },8000);
    return ()=>clearInterval(timer);
  },[router]);
  return null;
}
