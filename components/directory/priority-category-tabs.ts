import { CreditCard, Network, Server, ShoppingBag } from "lucide-react";
import { priorityLinks } from "@/lib/directory/taxonomy";

const categoryIcons = {
  ai: ShoppingBag,
  "ai-relay": Network,
  payments: CreditCard,
  vps: Server,
};

export const priorityCategoryTabs = priorityLinks.map(item => {
  const key = "category" in item ? item.category : "ai";
  return { item, key, Icon: categoryIcons[key] };
});
