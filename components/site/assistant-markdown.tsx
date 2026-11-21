import Link from "next/link";
import { isAssistantTool } from "@/lib/assistant/protocol";

function inline(text: string) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g).map((part, index) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) return isAssistantTool(link[2])
      ? <Link key={index} href={link[2]} prefetch={false}>{link[1]}</Link> : link[1];
    if (/^`[^`]+`$/.test(part)) return <code key={index}>{part.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

const listLine = /^\s*(-|\*|\d+[.)])\s+(.+)$/;

export function AssistantMarkdown({ text }: { text: string }) {
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
    ? <p key={index}>{inline(lines.join("\n"))}</p>
    : <Tag key={index}>{lines.map((line, item) => <li key={item}>{inline(line)}</li>)}</Tag>)}</div>;
}
