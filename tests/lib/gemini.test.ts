import { describe, it, expect, vi, beforeEach } from "vitest";

const generateContentMock = vi.fn();
const getGenerativeModelMock = vi.fn(() => ({ generateContent: generateContentMock }));

vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: getGenerativeModelMock,
    })),
    SchemaType: { OBJECT: "OBJECT", ARRAY: "ARRAY", STRING: "STRING", NUMBER: "NUMBER" },
  };
});

process.env.GEMINI_API_KEY = "test-key";

import { analyzeSlide, generateGuide } from "@/lib/gemini";

describe("analyzeSlide", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("parses a valid analyzer response", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            slideIntent: "CONCEPT",
            recommendedSections: ["trainerPointer", "whyItMatters"],
            confidence: 0.9,
          }),
      },
    });

    const result = await analyzeSlide("base64image", "some slide text");

    expect(result.slideIntent).toBe("CONCEPT");
    expect(result.recommendedSections).toEqual(["trainerPointer", "whyItMatters"]);
    expect(result.confidence).toBe(0.9);
  });

  it("throws when the response does not match the schema", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => JSON.stringify({ slideIntent: "NOT_REAL" }) },
    });

    await expect(analyzeSlide("base64image", "text")).rejects.toThrow();
  });
});

describe("generateGuide", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("parses a valid generator response", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            sections: [
              { type: "trainerPointer", title: "Trainer Pointer", content: "Say hello." },
            ],
          }),
      },
    });

    const result = await generateGuide("base64image", "text", "WELCOME", ["trainerPointer"]);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].type).toBe("trainerPointer");
  });
});
