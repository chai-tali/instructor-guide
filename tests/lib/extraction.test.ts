import { describe, it, expect } from "vitest";
import path from "node:path";
import { extractSlideTexts } from "@/lib/extraction";

describe("extractSlideTexts", () => {
  it("extracts text per slide in order from the fixture deck", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/sample.pptx");
    const texts = await extractSlideTexts(fixturePath);

    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain("Welcome to the Course");
    expect(texts[1]).toContain("Agenda");
    expect(texts[1]).toContain("Introduction");
    expect(texts[2]).toContain("Thank You");
  });
});
