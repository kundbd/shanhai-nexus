import { diffLines } from "diff";

export const MAX_DIFF_LENGTH = 80_000;
const MAX_LINES = 2000;

export type DiffBlock = { kind: "added" | "removed" | "equal"; text: string; count: number };

export function compareText(before: string, after: string) {
  if (Math.max(before.length, after.length) > MAX_DIFF_LENGTH) {
    throw new Error("每份文本最多支持 80,000 个字符。");
  }
  const left = before.replace(/\r\n?/g, "\n");
  const right = after.replace(/\r\n?/g, "\n");
  if ([left, right].some((value) => value.split("\n").length > MAX_LINES + Number(value.endsWith("\n")))) {
    throw new Error("每份文本最多支持 2,000 行。");
  }
  const changes = diffLines(left, right, { timeout: 175, maxEditLength: MAX_LINES * 2 });
  if (!changes) throw new Error("差异过多，暂时无法完成对比。请缩小比较范围。");
  const blocks: DiffBlock[] = changes.map(({ added, removed, value, count }) => ({
    kind: added ? "added" : removed ? "removed" : "equal", text: value, count,
  }));
  const totals = blocks.reduce((result, block) => {
    if (block.kind !== "equal") result[block.kind] += block.count;
    return result;
  }, { added: 0, removed: 0 });
  const changed = totals.added || totals.removed;
  const output = changed ? blocks.flatMap((block) => {
    const prefix = block.kind === "added" ? "+ " : block.kind === "removed" ? "- " : "  ";
    const rows = block.text.replace(/\n$/, "").split("\n").map((line) => prefix + line);
    if (!block.text.endsWith("\n")) rows.push("  ⋯ 末行无换行");
    return rows;
  }).join("\n") : "两份文本相同。";
  return { output, blocks: changed ? blocks : [], note: changed ? `新增 ${totals.added} 行，删除 ${totals.removed} 行` : "两份文本相同。" };
}
