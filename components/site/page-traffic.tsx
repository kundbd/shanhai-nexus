"use client";

import { usePathname } from "next/navigation";
import { useEffect,useRef,useState } from "react";
import { isTrafficPath,isTrafficVisitor,trafficPostId,trafficVisitorHeader } from "@/lib/traffic-path";

const browserVisitorKey="shanhai-traffic-visitor";

function browserVisitor() {
  try {
    const saved=localStorage.getItem(browserVisitorKey);
    if(isTrafficVisitor(saved))return saved;
    const visitor=crypto.randomUUID();
    localStorage.setItem(browserVisitorKey,visitor);
    return visitor;
  } catch { return undefined; }
}

export function usePageVisitor(path:string|null) {
  const lastReported=useRef<string|null>(null);
  const [count,setCount]=useState<{path:string;visitors:number}>();

  useEffect(()=>{
    if (!path||!isTrafficPath(path)) { lastReported.current=null;return; }
    const page=path;

    function report() {
      if (document.visibilityState!=="visible" || lastReported.current===page) return;
      const visitor=browserVisitor();
      if(!visitor)return;
      lastReported.current=page;
      void fetch("/api/traffic",{
        method:"POST",body:page,headers:{[trafficVisitorHeader]:visitor},credentials:"omit",referrerPolicy:"no-referrer",keepalive:true,
      }).then(async response=>{
        if(response.status!==200)return;
        const {visitors}=await response.json() as {visitors?:number};
        if(lastReported.current===page&&typeof visitors==="number"&&Number.isSafeInteger(visitors)&&visitors>=0) {
          setCount(previous=>({path:page,visitors:Math.max(visitors,previous?.path===page?previous.visitors:0)}));
        }
      }).catch(()=>{});
    }
    report();
    document.addEventListener("visibilitychange",report);
    return ()=>document.removeEventListener("visibilitychange",report);
  },[path]);

  return count?.path===path?count.visitors:undefined;
}

export function PageTraffic() {
  const path=usePathname();
  usePageVisitor(path&&trafficPostId(path)===undefined?path:null);
  return null;
}
