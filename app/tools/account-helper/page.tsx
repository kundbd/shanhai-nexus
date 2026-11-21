import { AccountHelper } from "@/components/tools/account-helper";
import { ToolPage, toolMetadata } from "@/components/tools/tool-page";
import { accountHelperDescription, accountHelperTitle, accountHelperPath } from "@/lib/tools/account-helper";

export function generateMetadata() {
  return toolMetadata(accountHelperTitle, accountHelperDescription, accountHelperPath);
}

export default function AccountHelperPage() {
  return <ToolPage title={accountHelperTitle} description={accountHelperDescription}><AccountHelper /></ToolPage>;
}
