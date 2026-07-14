import { describe, it, expect } from "vitest";
import { slideAnalysisSchema, instructorGuideSchema, deckAnalysisSchema, contentModeSchema, studentGuideSchema } from "@/lib/schemas";

describe("slideAnalysisSchema", () => {
  it("accepts a valid analysis payload", () => {
    const result = slideAnalysisSchema.parse({
      slideIntent: "ARCHITECTURE",
      recommendedSections: ["trainerPointer", "mentalModel"],
      confidence: 0.97,
      slideTitle: "The Five-Block Architecture",
    });
    expect(result.slideIntent).toBe("ARCHITECTURE");
    expect(result.slideTitle).toBe("The Five-Block Architecture");
  });

  it("accepts a null slideTitle", () => {
    const result = slideAnalysisSchema.parse({
      slideIntent: "OTHER",
      recommendedSections: [],
      confidence: 0.6,
      slideTitle: null,
    });
    expect(result.slideTitle).toBeNull();
  });

  it("rejects an invalid slideIntent", () => {
    expect(() =>
      slideAnalysisSchema.parse({
        slideIntent: "NOT_A_REAL_INTENT",
        recommendedSections: [],
        confidence: 0.5,
        slideTitle: null,
      })
    ).toThrow();
  });

  it("rejects confidence outside 0..1", () => {
    expect(() =>
      slideAnalysisSchema.parse({
        slideIntent: "SUMMARY",
        recommendedSections: [],
        confidence: 1.5,
        slideTitle: null,
      })
    ).toThrow();
  });

  it("accepts KEY_TAKEAWAYS intent with keyTakeaways recommended", () => {
    const result = slideAnalysisSchema.parse({
      slideIntent: "KEY_TAKEAWAYS",
      recommendedSections: ["keyTakeaways"],
      confidence: 0.95,
      slideTitle: "Key Takeaways",
    });
    expect(result.slideIntent).toBe("KEY_TAKEAWAYS");
    expect(result.recommendedSections).toEqual(["keyTakeaways"]);
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

  it("accepts a trainerPointer section with keyPoints", () => {
    const result = instructorGuideSchema.parse({
      sections: [
        {
          type: "trainerPointer",
          title: "Trainer Pointer",
          content: "Welcome everyone.",
          keyPoints: ["This sets the tone.", "It builds rapport."],
        },
      ],
    });
    expect(result.sections[0].keyPoints).toEqual(["This sets the tone.", "It builds rapport."]);
  });

  it("accepts a section without keyPoints", () => {
    const result = instructorGuideSchema.parse({
      sections: [{ type: "mentalModel", title: "Mental Model", content: "Think of it like..." }],
    });
    expect(result.sections[0].keyPoints).toBeUndefined();
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

describe("contentModeSchema", () => {
  it("accepts TEXTUAL", () => {
    expect(contentModeSchema.parse({ contentMode: "TEXTUAL" }).contentMode).toBe("TEXTUAL");
  });

  it("accepts VISUAL", () => {
    expect(contentModeSchema.parse({ contentMode: "VISUAL" }).contentMode).toBe("VISUAL");
  });

  it("rejects an invalid contentMode value", () => {
    expect(() => contentModeSchema.parse({ contentMode: "SOMETHING_ELSE" })).toThrow();
  });
});

describe("studentGuideSchema", () => {
  it("accepts sections with content or keyPoints", () => {
    const result = studentGuideSchema.parse({
      sections: [
        { type: "coreExplanation", title: "Concept Explanation", content: "It works like this." },
        { type: "rememberThis", title: "Remember This", keyPoints: ["Point one.", "Point two."] },
      ],
    });
    expect(result.sections).toHaveLength(2);
  });

  it("rejects a section missing required fields", () => {
    expect(() => studentGuideSchema.parse({ sections: [{ title: "Missing type" }] })).toThrow();
  });
});
