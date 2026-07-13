import { describe, it, expect } from "vitest";
import { slideAnalysisSchema, instructorGuideSchema, deckAnalysisSchema } from "@/lib/schemas";

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

describe("deckAnalysisSchema", () => {
  it("accepts a full deck analysis payload", () => {
    const result = deckAnalysisSchema.parse({
      workshopTitle: "AI in Practice",
      duration: "4:00 PM to 6:30 PM",
      learningObjectives: [
        "Understand the five-block prompt architecture",
        "Apply structured prompts to extract financial data",
        "Identify common LLM hallucination risks",
      ],
    });
    expect(result.workshopTitle).toBe("AI in Practice");
    expect(result.learningObjectives).toHaveLength(3);
  });

  it("accepts null workshopTitle and duration", () => {
    const result = deckAnalysisSchema.parse({
      workshopTitle: null,
      duration: null,
      learningObjectives: ["Understand X", "Apply Y", "Identify Z"],
    });
    expect(result.workshopTitle).toBeNull();
    expect(result.duration).toBeNull();
  });

  it("rejects fewer than 3 learning objectives", () => {
    expect(() =>
      deckAnalysisSchema.parse({
        workshopTitle: null,
        duration: null,
        learningObjectives: ["Understand X"],
      })
    ).toThrow();
  });

  it("rejects more than 5 learning objectives", () => {
    expect(() =>
      deckAnalysisSchema.parse({
        workshopTitle: null,
        duration: null,
        learningObjectives: ["A", "B", "C", "D", "E", "F"],
      })
    ).toThrow();
  });
});
