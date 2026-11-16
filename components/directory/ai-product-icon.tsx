import Image from "next/image";
import type { ReactNode } from "react";
import { Smartphone } from "lucide-react";
import { codexVerificationProduct } from "@/lib/directory/ai-product";

const brandIcons = new Map([
  ["ChatGPT", "openai.svg"],
  ["OpenAI", "openai.svg"],
  ["Claude", "claude-color.svg"],
  ["Gemini", "gemini-color.svg"],
  ["Grok", "grok.svg"],
  ["DeepSeek", "deepseek-color.svg"],
  ["Cursor", "cursor.svg"],
  ["Perplexity", "perplexity-color.svg"],
  ["GLM", "zai.svg"],
  ["MiniMax", "minimax-color.svg"],
  ["Kimi", "kimi-color.svg"],
]);

export function AiProductIcon({ product, fallback = null }: { product: string; fallback?: ReactNode }) {
  if (product === codexVerificationProduct) {
    return <Smartphone className="ai-product-icon" size={16} aria-hidden="true" />;
  }

  const filename = brandIcons.get(product);
  if (!filename) return fallback;

  const source = `/ai-product-icons/${filename}`;
  if (filename.endsWith("-color.svg") && product !== "Kimi") {
    return <Image className="ai-product-icon" src={source} width={16} height={16} alt="" unoptimized />;
  }

  const mask = `url(${source}) center / contain no-repeat`;
  return <span className="ai-product-icon ai-product-mask" aria-hidden="true" style={{ mask, WebkitMask: mask }} />;
}
