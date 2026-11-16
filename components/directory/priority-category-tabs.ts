import { CreditCard, Network, Plane, Server, ShoppingBag } from "lucide-react";
import { priorityLinks } from "@/lib/directory/taxonomy";

const categoryIcons = {
  ai: ShoppingBag,
  "ai-relay": Network,
  airport: Plane,
  payments: CreditCard,
  vps: Server,
};

export const priorityCategoryTabs = priorityLinks.map(item => {
  const key = "category" in item ? item.category : item.group === "connections" ? "airport" : "ai";
  return { item, key, Icon: categoryIcons[key] };
});
