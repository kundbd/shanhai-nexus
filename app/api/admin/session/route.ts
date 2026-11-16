import { type NextRequest } from "next/server";
import { adminActor, login, mutationOrigin, secureCookie, sessionCookie, sessionSeconds } from "@/lib/directory/auth";
import { formFields,returnTo } from "@/lib/directory/admin-request";

export async function POST(request: NextRequest) {
  if (!mutationOrigin(request)) return new Response("禁止跨来源请求",{status:403});
  try {
    const form = await formFields(request,5000);
    const cookie = { path:"/",httpOnly:true,secure:secureCookie(request),sameSite:"strict" as const };
    if (form.action === "logout") {
      if (!adminActor(request.cookies.get(sessionCookie)?.value)) return new Response("请登录",{status:401});
      const response = returnTo(request,"/admin/login");
      response.cookies.set(sessionCookie,"",{...cookie,maxAge:0});
      return response;
    }
    const token = login(form.username ?? "",form.password ?? "");
    if (!token) return returnTo(request,"/admin/login","身份验证失败，或尝试次数过多，请稍后重试。");
    const response = returnTo(request,"/admin");
    response.cookies.set(sessionCookie,token,{...cookie,maxAge:sessionSeconds});
    return response;
  } catch {
    return returnTo(request,"/admin/login","表单无效。");
  }
}
