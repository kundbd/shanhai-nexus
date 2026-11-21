import { BillingAddressGenerator } from "@/components/tools/billing-address-generator";
import { ToolPage, toolMetadata } from "@/components/tools/tool-page";
import { billingDescription, billingTitle, billingToolPath } from "@/lib/tools/billing-address";

export function generateMetadata() {
  return toolMetadata(billingTitle, billingDescription, billingToolPath);
}

export default function BillingAddressPage() {
  return <ToolPage title={billingTitle} description={billingDescription}><BillingAddressGenerator /></ToolPage>;
}
