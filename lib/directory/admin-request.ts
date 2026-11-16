import { NextResponse, type NextRequest } from "next/server";
import { boundedText } from "./imports";

export async function formFields(request: NextRequest, maximum = 500_000) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new Error("不支持的表单格式。");
  return Object.fromEntries(new URLSearchParams(await boundedText(request,maximum)));
}

export function returnTo(request: NextRequest, path: string, message?: string, ok = false) {
  const redirect = new URL(path,process.env.ADMIN_ORIGIN || request.url);
  if (message) redirect.searchParams.set(ok ? "ok" : "error",message.slice(0,190));
  return NextResponse.redirect(redirect,303);
}

export function safeError(error: unknown) {
  if (!(error instanceof Error)) return "操作失败，请重试。";
  if (/SQLITE|constraint failed|database is locked/i.test(error.message)) return "资料重复、仍被引用或数据库暂不可用。请检查后重试。";
  if (error instanceof SyntaxError) return "输入格式有误。请检查 JSON 或网址。";
  return error.message;
}
