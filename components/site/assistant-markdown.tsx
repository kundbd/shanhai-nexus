import Link from "next/link";
import { isAssistantTool } from "@/lib/assistant/protocol";

function inline(text: string, links?: readonly string[]) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g).map((part, index) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      if (isAssistantTool(href) || links?.includes(href)) {
        return href.startsWith("/") ? <Link key={index} href={href} prefetch={false}>{label}</Link>
          : <a key={index} href={href} target="_blank" rel="noopener noreferrer nofollow">{label} ↗</a>;
      }
      return label;
    }
    if (/^`[^`]+`$/.test(part)) return <code key={index}>{part.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

const listLine = /^\s*(-|\*|\d+[.)])\s+(.+)$/;

export function AssistantMarkdown({ text, links }: { text: string; links?: readonly string[] }) {
  const blocks: { kind: "p" | "ul" | "ol"; lines: string[] }[] = [];
  let block: typeof blocks[number] | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) { block = undefined; continue; }
    const item = listLine.exec(line);
    const kind = item ? (/^\d/.test(item[1]) ? "ol" : "ul") : "p";
    if (block?.kind !== kind) {
      block = { kind, lines: [] };
      blocks.push(block);
    }
    block.lines.push(item?.[2] ?? line.replace(/^#{1,6}\s+/, ""));
  }
  return <div className="assistant-markdown">{blocks.map(({ kind: Tag, lines }, index) => Tag === "p"
    ? <p key={index}>{inline(lines.join("\n"), links)}</p>
    : <Tag key={index}>{lines.map((line, item) => <li key={item}>{inline(line, links)}</li>)}</Tag>)}</div>;
}
