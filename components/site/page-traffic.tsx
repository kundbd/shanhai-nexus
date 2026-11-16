"use client";

import { usePathname } from "next/navigation";
import { useEffect,useRef,useState } from "react";
import { isTrafficPath,trafficPostId } from "@/lib/traffic-path";

export function usePageView(path:string|null) {
  const lastReported=useRef<string|null>(null);
  const [count,setCount]=useState<{path:string;views:number}>();

  useEffect(()=>{
    if (!path||!isTrafficPath(path)) { lastReported.current=null;return; }
    const page=path;

    function report() {
      if (document.visibilityState!=="visible" || lastReported.current===page) return;
      lastReported.current=page;
      void fetch("/api/traffic",{
        method:"POST",body:page,credentials:"omit",referrerPolicy:"no-referrer",keepalive:true,
      }).then(async response=>{
        if(response.status!==200)return;
        const {views}=await response.json() as {views?:number};
        if(lastReported.current===page&&typeof views==="number"&&Number.isSafeInteger(views)&&views>=0) {
          setCount(previous=>({path:page,views:Math.max(views,previous?.path===page?previous.views:0)}));
        }
      }).catch(()=>{});
    }
    report();
    document.addEventListener("visibilitychange",report);
    return ()=>document.removeEventListener("visibilitychange",report);
  },[path]);

  return count?.path===path?count.views:undefined;
}

export function PageTraffic() {
  const path=usePathname();
  usePageView(path&&trafficPostId(path)===undefined?path:null);
  return null;
}
