import fs from "node:fs/promises";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, textNodeName: "#text" });

function collectText(node: unknown, out: string[]): void {
  if (node == null) return;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out);
    return;
  }
  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "a:t") {
        collectText(value, out);
      } else if (typeof value === "object") {
        collectText(value, out);
      }
    }
  }
}

export async function extractSlideTexts(pptxPath: string): Promise<string[]> {
  const buffer = await fs.readFile(pptxPath);
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)![1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)![1], 10);
      return na - nb;
    });

  const texts: string[] = [];
  for (const filename of slideFiles) {
    const xml = await zip.files[filename].async("string");
    const parsed = parser.parse(xml);
    const out: string[] = [];
    collectText(parsed, out);
    texts.push(out.join("\n"));
  }
  return texts;
}
