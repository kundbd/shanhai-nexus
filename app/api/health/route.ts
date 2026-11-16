import { directory } from "@/lib/directory/db";

export const dynamic = "force-dynamic";
export function GET() {
  try {
    directory().prepare("SELECT 1 FROM migrations LIMIT 1").get();
    return Response.json({status:"ok"},{headers:{"Cache-Control":"no-store"}});
  } catch {
    return Response.json({status:"unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
