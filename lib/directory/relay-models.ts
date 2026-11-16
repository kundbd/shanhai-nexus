const relayBrands = new Map([
  ["deepseek", "DeepSeek"],
  ["claude", "Claude"],
  ["gpt", "OpenAI"],
  ["glm", "GLM"],
  ["minimax", "MiniMax"],
  ["kimi", "Kimi"],
  ["gemini", "Gemini"],
  ["grok", "Grok"],
]);

export function relayModelKey(model: string) {
  return model.normalize("NFKC").trim().toLowerCase().replace(/[\s_\p{Pd}]+/gu, "-");
}

export function relayModelBrand(model: string) {
  return relayBrands.get(relayModelKey(model).split("-", 1)[0]);
}

export function groupRelayModels(models: readonly string[]) {
  const groups = new Map<string, string[]>();
  for (const model of models) {
    const brand = relayModelBrand(model) ?? "其他模型";
    const versions = groups.get(brand);
    if (versions) versions.push(model);
    else groups.set(brand, [model]);
  }
  return [...groups].map(([brand, versions]) => ({ brand, versions }));
}

export function relayVersionLabel(model: string, brand: string) {
  const prefix = `${brand.toLowerCase()} `;
  return model.toLowerCase().startsWith(prefix) ? model.slice(prefix.length) : model;
}
