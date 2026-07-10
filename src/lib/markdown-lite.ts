export interface MarkdownRun {
  text: string;
  bold: boolean;
}

export interface MarkdownBlock {
  type: "paragraph" | "bullet";
  runs: MarkdownRun[];
}

const BULLET_PREFIX = /^[-*]\s+/;
const BOLD_SPAN = /\*\*(.+?)\*\*/g;

function isBulletLine(line: string): boolean {
  return BULLET_PREFIX.test(line);
}

function parseInlineRuns(line: string): MarkdownRun[] {
  const runs: MarkdownRun[] = [];
  const regex = new RegExp(BOLD_SPAN);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: line.slice(lastIndex, match.index), bold: false });
    }
    runs.push({ text: match[1], bold: true });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < line.length) {
    runs.push({ text: line.slice(lastIndex), bold: false });
  }

  return runs;
}

export function parseMarkdownLite(text: string): MarkdownBlock[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const blocks: MarkdownBlock[] = [];
  const rawBlocks = trimmed.split(/\n\s*\n/);

  for (const rawBlock of rawBlocks) {
    const lines = rawBlock
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) continue;

    const isBulletBlock = lines.every(isBulletLine);

    if (isBulletBlock) {
      for (const line of lines) {
        const content = line.replace(BULLET_PREFIX, "");
        blocks.push({ type: "bullet", runs: parseInlineRuns(content) });
      }
    } else {
      for (const line of lines) {
        blocks.push({ type: "paragraph", runs: parseInlineRuns(line) });
      }
    }
  }

  return blocks;
}
