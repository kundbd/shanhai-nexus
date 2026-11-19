import { CreditCard, Network, Server, ShoppingBag } from "lucide-react";
import { categoryGroups, priorityLinks } from "@/lib/directory/taxonomy";
import type { ContentVisibility } from "@/lib/geo/visibility";

const categoryIcons = {
  ai: ShoppingBag,
  "ai-relay": Network,
  payments: CreditCard,
  vps: Server,
};

export const priorityCategoryTabs = priorityLinks.map(item => {
  const key = "category" in item ? item.category : "ai" as const;
  return { item, key, Icon: categoryIcons[key] };
});

export function visiblePriorityCategoryTabs(visibility: ContentVisibility) {
  return priorityCategoryTabs.filter(({item}) => "group" in item
    ? categoryGroups[item.group].some(category => visibility.categoryAllowed(category))
    : visibility.categoryAllowed(item.category));
}
