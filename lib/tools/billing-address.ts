export const billingToolPath = "/tools/us-billing-address";
export const billingTitle = "美区免税州账单地址生成器";
export const billingDescription = "生成美国无州级销售税地区的账单地址示例，用于表单测试。";

export const billingStates = [
  { code: "OR", name: "俄勒冈州", city: "Salem", zip: "97301" },
  { code: "DE", name: "特拉华州", city: "Dover", zip: "19901" },
  { code: "MT", name: "蒙大拿州", city: "Helena", zip: "59601" },
  { code: "NH", name: "新罕布什尔州", city: "Concord", zip: "03301" },
  { code: "AK", name: "阿拉斯加州", city: "Juneau", zip: "99801" },
] as const;

export type BillingState = (typeof billingStates)[number];
