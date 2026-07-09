import { describe, it, expect } from "vitest";
import { slideAnalysisSchema, instructorGuideSchema } from "@/lib/schemas";

describe("slideAnalysisSchema", () => {
  it("accepts a valid analysis payload", () => {
    const result = slideAnalysisSchema.parse({
      slideIntent: "ARCHITECTURE",
      recommendedSections: ["trainerPointer", "whyItMatters"],
      confidence: 0.97,
    });
    expect(result.slideIntent).toBe("ARCHITECTURE");
  });

  it("rejects an invalid slideIntent", () => {
    expect(() =>
      slideAnalysisSchema.parse({
        slideIntent: "NOT_A_REAL_INTENT",
        recommendedSections: [],
        confidence: 0.5,
      })
    ).toThrow();
  });

  it("rejects confidence outside 0..1", () => {
    expect(() =>
      slideAnalysisSchema.parse({
        slideIntent: "SUMMARY",
        recommendedSections: [],
        confidence: 1.5,
      })
    ).toThrow();
  });
});

describe("instructorGuideSchema", () => {
  it("accepts sections with content or items", () => {
    const result = instructorGuideSchema.parse({
      sections: [
        { type: "trainerPointer", title: "Trainer Pointer", content: "Say hi." },
        {
          type: "faq",
          title: "FAQ",
          items: [{ question: "Why?", answer: "Because." }],
        },
      ],
    });
    expect(result.sections).toHaveLength(2);
  });

  it("rejects a section missing required fields", () => {
    expect(() =>
      instructorGuideSchema.parse({ sections: [{ title: "Missing type" }] })
    ).toThrow();
  });
});
