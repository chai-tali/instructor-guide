import { describe, it, expect } from "vitest";
import { sectionDisplayTitle } from "@/types/guide";

describe("sectionDisplayTitle", () => {
  it("prefers the canonical SECTION_TITLES entry over Gemini's own title for a known type", () => {
    expect(sectionDisplayTitle({ type: "howThisFits", title: "How This Fits" })).toBe(
      "Relevance of the Slide"
    );
  });

  it("falls back to Gemini's title for an unrecognized section type", () => {
    expect(sectionDisplayTitle({ type: "customSection", title: "Custom Heading" })).toBe(
      "Custom Heading"
    );
  });

  it("falls back to the raw type string when both the title and the map are empty", () => {
    expect(sectionDisplayTitle({ type: "customSection", title: "" })).toBe("customSection");
  });
});
