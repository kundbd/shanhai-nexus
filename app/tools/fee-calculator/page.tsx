import { FeeCalculator } from "@/components/tools/fee-calculator";
import { ToolPage, toolMetadata } from "@/components/tools/tool-page";
import { feeDescription, feeTitle, feeToolPath } from "@/lib/tools/fee-calculator";

export function generateMetadata() {
  return toolMetadata(feeTitle, feeDescription, feeToolPath);
}

export default function FeeCalculatorPage() {
  return <ToolPage title={feeTitle} description={feeDescription}><FeeCalculator /></ToolPage>;
}
