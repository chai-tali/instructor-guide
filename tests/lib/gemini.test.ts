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

import { analyzeSlide, generateGuide, analyzeDeck } from "@/lib/gemini";

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

describe("analyzeDeck", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("parses a valid deck analysis response", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            workshopTitle: "AI in Practice",
            duration: "4:00 PM to 6:30 PM",
            learningObjectives: [
              "Understand the five-block prompt architecture",
              "Apply structured prompts to extract financial data",
              "Identify common LLM hallucination risks",
            ],
          }),
      },
    });

    const result = await analyzeDeck(["Welcome slide text", "Agenda slide text"]);

    expect(result.workshopTitle).toBe("AI in Practice");
    expect(result.duration).toBe("4:00 PM to 6:30 PM");
    expect(result.learningObjectives).toHaveLength(3);
  });

  it("passes through null duration and workshopTitle unchanged", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            workshopTitle: null,
            duration: null,
            learningObjectives: ["Understand X", "Apply Y", "Identify Z"],
          }),
      },
    });

    const result = await analyzeDeck(["Some slide text with no stated schedule"]);

    expect(result.workshopTitle).toBeNull();
    expect(result.duration).toBeNull();
  });

  it("throws when the response does not match the schema", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => JSON.stringify({ workshopTitle: "X" }) },
    });

    await expect(analyzeDeck(["text"])).rejects.toThrow();
  });

  it("salvages a valid workshopTitle/duration when learningObjectives is out of range", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            workshopTitle: "AI in Practice",
            duration: "4:00 PM to 6:30 PM",
            learningObjectives: ["Understand X"],
          }),
      },
    });

    const result = await analyzeDeck(["Some slide text"]);

    expect(result.workshopTitle).toBe("AI in Practice");
    expect(result.duration).toBe("4:00 PM to 6:30 PM");
    expect(result.learningObjectives).toEqual([]);
  });

  it("salvages a valid workshopTitle/duration when learningObjectives has too many items", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            workshopTitle: "AI in Practice",
            duration: null,
            learningObjectives: ["A", "B", "C", "D", "E", "F"],
          }),
      },
    });

    const result = await analyzeDeck(["Some slide text"]);

    expect(result.workshopTitle).toBe("AI in Practice");
    expect(result.duration).toBeNull();
    expect(result.learningObjectives).toEqual([]);
  });
});
