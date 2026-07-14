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

import { analyzeSlide, generateGuide, analyzeDeck, classifyContentMode, generateStudentGuide } from "@/lib/gemini";
import type { ContentMode, StudentGuide } from "@/types/guide";

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
            recommendedSections: ["trainerPointer", "mentalModel"],
            confidence: 0.9,
            slideTitle: "Structured Prompting",
          }),
      },
    });

    const result = await analyzeSlide("base64image", "some slide text");

    expect(result.slideIntent).toBe("CONCEPT");
    expect(result.recommendedSections).toEqual(["trainerPointer", "mentalModel"]);
    expect(result.confidence).toBe(0.9);
    expect(result.slideTitle).toBe("Structured Prompting");
  });

  it("passes through a null slideTitle when the slide has no clear title", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            slideIntent: "OTHER",
            recommendedSections: [],
            confidence: 0.6,
            slideTitle: null,
          }),
      },
    });

    const result = await analyzeSlide("base64image", "some slide text");

    expect(result.slideTitle).toBeNull();
  });

  it("strips em dashes from slideTitle", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            slideIntent: "CONCEPT",
            recommendedSections: [],
            confidence: 0.9,
            slideTitle: "Structured Prompting—Financial Analysis",
          }),
      },
    });

    const result = await analyzeSlide("base64image", "text");

    expect(result.slideTitle).toBe("Structured Prompting, Financial Analysis");
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

  it("includes keyPoints on a trainerPointer response", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            sections: [
              {
                type: "trainerPointer",
                title: "Trainer Pointer",
                content: "Welcome the class.",
                keyPoints: ["Sets a collaborative tone.", "Establishes the agenda."],
              },
            ],
          }),
      },
    });

    const result = await generateGuide("base64image", "text", "WELCOME", ["trainerPointer"]);

    expect(result.sections[0].keyPoints).toEqual([
      "Sets a collaborative tone.",
      "Establishes the agenda.",
    ]);
  });

  it("strips em dashes from content, keyPoints, and items", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            sections: [
              {
                type: "trainerPointer",
                title: "Trainer Pointer",
                content: "Explain the concept—clearly and concisely.",
                keyPoints: ["Builds trust—fast.", "Keeps focus—on the task."],
                items: [{ question: "Why—this order?", answer: "Because it flows—naturally." }],
              },
            ],
          }),
      },
    });

    const result = await generateGuide("base64image", "text", "WELCOME", ["trainerPointer"]);

    const section = result.sections[0];
    expect(section.content).toBe("Explain the concept, clearly and concisely.");
    expect(section.keyPoints).toEqual(["Builds trust, fast.", "Keeps focus, on the task."]);
    expect(section.items).toEqual([{ question: "Why, this order?", answer: "Because it flows, naturally." }]);
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

  it("strips em dashes from workshopTitle, duration, and learningObjectives", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            workshopTitle: "AI in Practice—Session 1",
            duration: "2 hours—approx",
            learningObjectives: [
              "Understand prompting—the fundamentals",
              "Apply structured extraction—to filings",
              "Identify hallucination risks—in outputs",
            ],
          }),
      },
    });

    const result = await analyzeDeck(["text"]);

    expect(result.workshopTitle).toBe("AI in Practice, Session 1");
    expect(result.duration).toBe("2 hours, approx");
    expect(result.learningObjectives).toEqual([
      "Understand prompting, the fundamentals",
      "Apply structured extraction, to filings",
      "Identify hallucination risks, in outputs",
    ]);
  });
});

describe("classifyContentMode", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("returns TEXTUAL for a text-heavy slide", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => JSON.stringify({ contentMode: "TEXTUAL" }) },
    });

    const result: ContentMode = await classifyContentMode("base64image", "some slide text");

    expect(result).toBe("TEXTUAL");
  });

  it("returns VISUAL for a diagram-heavy slide", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => JSON.stringify({ contentMode: "VISUAL" }) },
    });

    const result = await classifyContentMode("base64image", "some slide text");

    expect(result).toBe("VISUAL");
  });

  it("throws when the response does not match the schema", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => JSON.stringify({ contentMode: "NOT_REAL" }) },
    });

    await expect(classifyContentMode("base64image", "text")).rejects.toThrow();
  });
});

describe("generateStudentGuide", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("parses a full 4-section response for a teaching slide", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            sections: [
              { type: "coreExplanation", title: "Concept Explanation", content: "A structured prompt gives clear instructions." },
              { type: "rememberThis", title: "Remember This", keyPoints: ["Every prompt starts with a role.", "Constraints reduce hallucinations."] },
              { type: "mentalModel", title: "Mental Model", content: "Think of it like a project brief." },
              { type: "selfProbingQuestions", title: "Self-Probing Questions", keyPoints: ["Why define the AI's role?", "What happens without constraints?"] },
            ],
          }),
      },
    });

    const result = await generateStudentGuide("base64image", "text", "CONCEPT", "TEXTUAL");

    expect(result.sections).toHaveLength(4);
    expect(result.sections.map((s) => s.type)).toEqual([
      "coreExplanation",
      "rememberThis",
      "mentalModel",
      "selfProbingQuestions",
    ]);
  });

  it("parses a coreExplanation-only response for a non-teaching slide", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            sections: [
              { type: "coreExplanation", title: "Concept Explanation", content: "This slide thanks participants for attending." },
            ],
          }),
      },
    });

    const result = await generateStudentGuide("base64image", "text", "THANK_YOU", null);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].type).toBe("coreExplanation");
  });

  it("discards extra sections the model returns for a non-teaching slide, keeping only coreExplanation", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            sections: [
              { type: "coreExplanation", title: "Concept Explanation", content: "This slide welcomes participants." },
              { type: "rememberThis", title: "Remember This", keyPoints: ["This should not survive."] },
            ],
          }),
      },
    });

    const result = await generateStudentGuide("base64image", "text", "WELCOME", null);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].type).toBe("coreExplanation");
  });

  it("strips em dashes from content and keyPoints", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            sections: [
              { type: "coreExplanation", title: "Concept Explanation", content: "It works like this—clearly." },
              { type: "rememberThis", title: "Remember This", keyPoints: ["Point one—matters.", "Point two—also matters."] },
            ],
          }),
      },
    });

    const result = await generateStudentGuide("base64image", "text", "CONCEPT", "TEXTUAL");

    expect(result.sections[0].content).toBe("It works like this, clearly.");
    expect(result.sections[1].keyPoints).toEqual(["Point one, matters.", "Point two, also matters."]);
  });

  it("throws when the response does not match the schema", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => JSON.stringify({ sections: [{ title: "Missing type" }] }) },
    });

    await expect(generateStudentGuide("base64image", "text", "CONCEPT", "TEXTUAL")).rejects.toThrow();
  });
});
