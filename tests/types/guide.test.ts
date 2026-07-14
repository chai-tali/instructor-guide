import { describe, it, expect } from "vitest";
import {
  sectionDisplayTitle,
  sgSectionDisplayTitle,
  parseGuideTypes,
  NON_TEACHING_INTENTS,
} from "@/types/guide";

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

describe("sgSectionDisplayTitle", () => {
  it("uses the model's own title for coreExplanation when present", () => {
    expect(sgSectionDisplayTitle({ type: "coreExplanation", title: "Visual Walkthrough" })).toBe(
      "Visual Walkthrough"
    );
  });

  it("falls back to 'Core Explanation' when coreExplanation has no title", () => {
    expect(sgSectionDisplayTitle({ type: "coreExplanation", title: "" })).toBe("Core Explanation");
  });

  it("prefers the canonical SG_SECTION_TITLES entry over the model's title for a known type", () => {
    expect(sgSectionDisplayTitle({ type: "rememberThis", title: "Anything" })).toBe("Remember This");
  });

  it("falls back to the model's title for an unrecognized section type", () => {
    expect(sgSectionDisplayTitle({ type: "customSection", title: "Custom Heading" })).toBe(
      "Custom Heading"
    );
  });
});

describe("NON_TEACHING_INTENTS", () => {
  it("contains exactly the four non-teaching slide intents", () => {
    expect(NON_TEACHING_INTENTS.sort()).toEqual(
      ["AGENDA", "SECTION_DIVIDER", "THANK_YOU", "WELCOME"].sort()
    );
  });
});

describe("parseGuideTypes", () => {
  it("parses a valid JSON array", () => {
    expect(parseGuideTypes('["ig","sg"]')).toEqual(["ig", "sg"]);
  });

  it("falls back to ['ig'] for null", () => {
    expect(parseGuideTypes(null)).toEqual(["ig"]);
  });

  it("falls back to ['ig'] for undefined", () => {
    expect(parseGuideTypes(undefined)).toEqual(["ig"]);
  });

  it("falls back to ['ig'] for malformed JSON", () => {
    expect(parseGuideTypes("not json")).toEqual(["ig"]);
  });

  it("falls back to ['ig'] for an empty array", () => {
    expect(parseGuideTypes("[]")).toEqual(["ig"]);
  });

  it("filters out unknown guide type values", () => {
    expect(parseGuideTypes('["ig","bogus"]')).toEqual(["ig"]);
  });
});
