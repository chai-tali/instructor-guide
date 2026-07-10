import { describe, it, expect } from "vitest";
import { parseMarkdownLite } from "@/lib/markdown-lite";

describe("parseMarkdownLite", () => {
  it("parses a plain paragraph", () => {
    expect(parseMarkdownLite("Hello world")).toEqual([
      { type: "paragraph", runs: [{ text: "Hello world", bold: false }] },
    ]);
  });

  it("splits blank-line-separated blocks into separate paragraphs", () => {
    expect(parseMarkdownLite("First paragraph.\n\nSecond paragraph.")).toEqual([
      { type: "paragraph", runs: [{ text: "First paragraph.", bold: false }] },
      { type: "paragraph", runs: [{ text: "Second paragraph.", bold: false }] },
    ]);
  });

  it("splits multi-line text without a blank line into separate paragraphs", () => {
    expect(parseMarkdownLite("Line one.\nLine two.")).toEqual([
      { type: "paragraph", runs: [{ text: "Line one.", bold: false }] },
      { type: "paragraph", runs: [{ text: "Line two.", bold: false }] },
    ]);
  });

  it("parses bold spans within a paragraph", () => {
    expect(parseMarkdownLite("This is **bold** text.")).toEqual([
      {
        type: "paragraph",
        runs: [
          { text: "This is ", bold: false },
          { text: "bold", bold: true },
          { text: " text.", bold: false },
        ],
      },
    ]);
  });

  it("parses a bullet list", () => {
    expect(parseMarkdownLite("- First item\n- Second item")).toEqual([
      { type: "bullet", runs: [{ text: "First item", bold: false }] },
      { type: "bullet", runs: [{ text: "Second item", bold: false }] },
    ]);
  });

  it("parses bullets with bold spans, using * as the marker", () => {
    expect(parseMarkdownLite("* **Important**: read this\n* Another point")).toEqual([
      {
        type: "bullet",
        runs: [
          { text: "Important", bold: true },
          { text: ": read this", bold: false },
        ],
      },
      { type: "bullet", runs: [{ text: "Another point", bold: false }] },
    ]);
  });

  it("returns an empty array for empty or whitespace-only input", () => {
    expect(parseMarkdownLite("")).toEqual([]);
    expect(parseMarkdownLite("   \n\n  ")).toEqual([]);
  });

  it("treats unterminated bold markers as literal text", () => {
    expect(parseMarkdownLite("This has **unterminated bold")).toEqual([
      {
        type: "paragraph",
        runs: [{ text: "This has **unterminated bold", bold: false }],
      },
    ]);
  });
});
