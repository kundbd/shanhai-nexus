import { ToolPage, toolMetadata } from "@/components/tools/tool-page";
import { TotpGenerator } from "@/components/tools/totp-generator";
import { totpDescription, totpTitle, totpToolPath } from "@/lib/tools/totp";

export function generateMetadata() {
  return toolMetadata(totpTitle, totpDescription, totpToolPath);
}

export default function TotpPage() {
  return <ToolPage title={totpTitle} description={totpDescription}><TotpGenerator /></ToolPage>;
}
