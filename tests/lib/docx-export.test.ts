import { describe, it, expect } from "vitest";
import { stripPptxExtension } from "@/lib/docx-export";

describe("stripPptxExtension", () => {
  it("strips a .pptx extension", () => {
    expect(stripPptxExtension("My Deck.pptx")).toBe("My Deck");
  });

  it("strips a .PPTX extension case-insensitively", () => {
    expect(stripPptxExtension("My Deck.PPTX")).toBe("My Deck");
  });

  it("leaves a filename without a .pptx extension unchanged", () => {
    expect(stripPptxExtension("My Deck")).toBe("My Deck");
  });
});
