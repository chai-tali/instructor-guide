import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { z } from "zod";
import type { Schema } from "@google/generative-ai";
import { slideAnalysisSchema, instructorGuideSchema, contentModeSchema, studentGuideSchema } from "@/lib/schemas";
import { SLIDE_INTENTS, SECTION_KEYS } from "@/types/guide";
import type {
  SlideAnalysis,
  InstructorGuide,
  GuideSection,
  SlideIntent,
  SectionKey,
  DeckAnalysis,
  ContentMode,
  StudentGuide,
} from "@/types/guide";

const MODEL_NAME = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(apiKey);
}

// Gemini frequently uses em dashes regardless of prompt instructions; strip them
// deterministically as a safety net rather than relying on the prompt alone.
function stripEmDash(text: string): string {
  return text.replace(/\s*—\s*/g, ", ");
}

function sanitizeSection(section: GuideSection): GuideSection {
  return {
    ...section,
    title: stripEmDash(section.title),
    content: section.content !== undefined ? stripEmDash(section.content) : undefined,
    keyPoints: section.keyPoints?.map(stripEmDash),
    items: section.items?.map((item) => ({
      question: stripEmDash(item.question),
      answer: stripEmDash(item.answer),
    })),
  };
}

const ANALYZER_PROMPT = `You are an expert Instructional Designer.

Your job is NOT to explain the slide.

Your job is ONLY to analyze the slide and determine what instructor guide content should be generated.

You will receive:
- Slide image
- OCR extracted text

STEP 1: Determine the slide's instructional intent. Choose exactly ONE value from the allowed slideIntent enum.

STEP 1b: Identify the slide's own visible title text (the heading actually printed on the slide), ONLY if one is clearly present. If the slide has no clear title (e.g. a QR code slide, a pure image slide), return null. Do not invent or infer a title that isn't actually shown on the slide. NEVER use an em dash (—) in the title; use a comma, period, or parentheses instead.

STEP 2: Determine which instructor guide sections are genuinely useful. Available sections are:
trainerPointer, mentalModel, bestPractices, commonPitfalls, realWorldImplementation, howThisFits, faq, keyTakeaways.

Only recommend sections that genuinely improve teaching. Do NOT recommend sections simply because they exist.

Examples:
WELCOME -> trainerPointer
AGENDA -> trainerPointer
SECTION_DIVIDER -> trainerPointer
THANK_YOU -> (no sections)
SUMMARY -> trainerPointer
KEY_TAKEAWAYS -> keyTakeaways
CONCEPT -> trainerPointer, commonPitfalls, faq
ARCHITECTURE -> trainerPointer, mentalModel, commonPitfalls, faq
PROCESS -> trainerPointer, commonPitfalls, faq
CODE -> trainerPointer, bestPractices, commonPitfalls, faq
DEMO -> trainerPointer, bestPractices, commonPitfalls, faq
EXERCISE -> trainerPointer, bestPractices, faq

FAQ Rule: Recommend FAQ only if learners are reasonably expected to ask clarification questions about the concept.

Key Takeaways Rule: If the slide explicitly recaps what participants learned/covered across the session or program (e.g. headed "Key Takeaways", "What You Learned", "Recap"), set slideIntent to KEY_TAKEAWAYS and recommend ONLY keyTakeaways for that slide — do NOT also recommend trainerPointer.

STEP 3: Estimate your confidence. Return a value between 0.0 and 1.0.

Return ONLY valid JSON. No explanation. No markdown.`;

const GENERATOR_PROMPT = `You are an expert Instructional Designer.

The slide has already been analyzed. Its instructional intent has already been determined.

Your task is ONLY to generate the instructor guide sections listed in recommendedSections. Generate NOTHING else.

Section Rules:

trainerPointer: Explain how the trainer should present this slide. Use action-oriented language. Maximum 120 words. Also generate keyPoints: exactly 2-3 concise bullets, each a direct instruction telling the trainer exactly what to do or say while presenting this slide (e.g. "Ask participants to...", "Emphasize that...", "Demonstrate...", "Point out..."). Each point MUST be an instruction directed at the trainer — NOT a description or explanation of why the concept matters. Ground every point in the slide — never invent generic filler.

mentalModel: Provide ONE memorable analogy. Only if a natural analogy exists. Do not force analogies.

bestPractices: Provide 1-3 delivery tips for the trainer. Focus on teaching technique. Format each tip as its own markdown bullet line starting with "- ", one tip per line. Never combine multiple tips into a single sentence or paragraph.

commonPitfalls: Provide 1-3 learner misconceptions. These are mistakes learners commonly make while understanding this topic. NOT trainer mistakes. Format each misconception as its own markdown bullet line starting with "- ", one per line. Never combine multiple misconceptions into a single sentence or paragraph.

realWorldImplementation: Provide 1-3 practical examples of how this concept is used in industry. Only if grounded in the slide. Format each example as its own markdown bullet line starting with "- ", one per line. Never combine multiple examples into a single sentence or paragraph.

howThisFits: Explain how this concept connects to the surrounding learning journey. Avoid generic statements like "This comes next."

faq: Generate 2-5 realistic learner questions. Each must include a question and an answer. Do not invent advanced questions.

keyTakeaways: The slide recaps what participants learned/covered in the session. Explain how the trainer should walk participants through the specific takeaways actually listed on the slide — never invent generic filler. Maximum 120 words.

General Rules: Never invent information. Never generate generic filler. Generate ONLY the requested sections. Whenever a section rule asks for multiple bullets/tips/pitfalls/examples, each one MUST be on its own line, formatted as a markdown bullet ("- " or "* " prefix) — never merge multiple points into one sentence or paragraph. NEVER use an em dash (—) anywhere in any generated text; use a comma, period, or parentheses instead. Return ONLY valid JSON.`;

const analyzerResponseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    slideIntent: {
      type: SchemaType.STRING,
      format: "enum",
      enum: SLIDE_INTENTS as unknown as string[],
    },
    recommendedSections: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.STRING,
        format: "enum",
        enum: SECTION_KEYS as unknown as string[],
      },
    },
    confidence: { type: SchemaType.NUMBER },
    slideTitle: { type: SchemaType.STRING, nullable: true },
  },
  required: ["slideIntent", "recommendedSections", "confidence", "slideTitle"],
};

const generatorResponseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    sections: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          type: { type: SchemaType.STRING },
          title: { type: SchemaType.STRING },
          content: { type: SchemaType.STRING },
          items: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                question: { type: SchemaType.STRING },
                answer: { type: SchemaType.STRING },
              },
              required: ["question", "answer"],
            },
          },
          keyPoints: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
          },
        },
        required: ["type", "title"],
      },
    },
  },
  required: ["sections"],
};

export async function analyzeSlide(
  imageBase64: string,
  extractedText: string
): Promise<SlideAnalysis> {
  const model = getClient().getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: analyzerResponseSchema,
    },
  });

  const result = await model.generateContent([
    { text: ANALYZER_PROMPT },
    { text: `OCR extracted text:\n${extractedText}` },
    { inlineData: { mimeType: "image/png", data: imageBase64 } },
  ]);

  const parsed = JSON.parse(result.response.text());
  const analysis = slideAnalysisSchema.parse(parsed);
  return {
    ...analysis,
    slideTitle: analysis.slideTitle !== null ? stripEmDash(analysis.slideTitle) : null,
  };
}

const CONTENT_MODE_PROMPT = `You are an expert Instructional Designer.

Determine whether this slide is primarily TEXTUAL (mostly prose, bullet points, definitions) or primarily VISUAL (diagram, architecture, process, workflow, chart, graph, image, table -- where understanding the slide requires interpreting the visual, not just reading text).

Return ONLY valid JSON. No explanation. No markdown.`;

const contentModeResponseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    contentMode: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["TEXTUAL", "VISUAL"],
    },
  },
  required: ["contentMode"],
};

export async function classifyContentMode(
  imageBase64: string,
  extractedText: string
): Promise<ContentMode> {
  const model = getClient().getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: contentModeResponseSchema,
    },
  });

  const result = await model.generateContent([
    { text: CONTENT_MODE_PROMPT },
    { text: `OCR extracted text:\n${extractedText}` },
    { inlineData: { mimeType: "image/png", data: imageBase64 } },
  ]);

  const parsed = JSON.parse(result.response.text());
  return contentModeSchema.parse(parsed).contentMode;
}

export async function generateGuide(
  imageBase64: string,
  extractedText: string,
  slideIntent: SlideIntent,
  recommendedSections: SectionKey[]
): Promise<InstructorGuide> {
  const model = getClient().getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: generatorResponseSchema,
    },
  });

  const context = JSON.stringify({ slideIntent, recommendedSections });

  const result = await model.generateContent([
    { text: GENERATOR_PROMPT },
    { text: `Analysis context:\n${context}` },
    { text: `OCR extracted text:\n${extractedText}` },
    { inlineData: { mimeType: "image/png", data: imageBase64 } },
  ]);

  const parsed = JSON.parse(result.response.text());
  const guide = instructorGuideSchema.parse(parsed);
  return { sections: guide.sections.map(sanitizeSection) };
}

const SG_GENERATOR_PROMPT = `You are an expert Instructional Designer writing a Student Guide entry for a learner reading independently (not a trainer script).

Section Rules:

coreExplanation: If contentMode is TEXTUAL, write a Concept Explanation: a clear paragraph explaining the concept the slide teaches, in the learner's own study voice. If contentMode is VISUAL, write a Visual Walkthrough: explain what the diagram/chart/process/table shows and what it means, walking through its parts in order. Ground every sentence in the slide -- never invent information. If this is a non-teaching slide (no contentMode provided), write one short paragraph explaining what this slide is / why it's here, nothing more.

rememberThis: Exactly 2-3 crisp bullets capturing the single most important takeaways from this slide. Each bullet is a short, standalone, memorable statement -- not a summary sentence.

mentalModel: One memorable real-life analogy that makes the concept concrete. Only if a natural analogy exists -- do not force one.

selfProbingQuestions: 2-3 questions a learner should ask themselves to check their own understanding of this slide. Questions only, no answers.

General Rules: Never invent information. Never generate generic filler. Generate ONLY the requested sections. Whenever a section rule asks for multiple bullets/questions, each one MUST be its own array item -- never merge multiple points into one string. NEVER use an em dash (—) anywhere in any generated text; use a comma, period, or parentheses instead. Return ONLY valid JSON.`;

export async function generateStudentGuide(
  imageBase64: string,
  extractedText: string,
  slideIntent: SlideIntent,
  contentMode: ContentMode | null
): Promise<StudentGuide> {
  const model = getClient().getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: generatorResponseSchema,
    },
  });

  const context = JSON.stringify({ slideIntent, contentMode });

  const result = await model.generateContent([
    { text: SG_GENERATOR_PROMPT },
    { text: `Analysis context:\n${context}` },
    { text: `OCR extracted text:\n${extractedText}` },
    { inlineData: { mimeType: "image/png", data: imageBase64 } },
  ]);

  const parsed = JSON.parse(result.response.text());
  const guide = studentGuideSchema.parse(parsed);
  return { sections: guide.sections.map(sanitizeSection) };
}

const DECK_ANALYZER_PROMPT = `You are an expert Instructional Designer.

You will receive the OCR-extracted text of every slide in a training deck, in order.

Your job is to analyze the WHOLE deck (not one slide) and extract three things:

1. workshopTitle: The workshop/session title, ONLY if a slide explicitly states one (e.g. on a title or welcome slide). If no slide explicitly states a title, return null. Do not invent or infer a title from the general topic.

2. duration: An explicit statement of the total workshop/session duration or time schedule (e.g. "2 hours", "9:30 AM to 5:00 PM", "Day 1 and Day 2"), ONLY if a slide explicitly states one. If no slide explicitly states a duration or schedule, return null. NEVER estimate or infer a duration from slide count or content.

3. learningObjectives: Generate 3 to 5 learning objectives for the ENTIRE deck (not per-slide). Each objective MUST start with an imperative, base-form verb such as Understand, Apply, Identify, Explain, Analyze, Evaluate, Describe, Create, or Demonstrate. NEVER start an objective with a gerund/"-ing" form (do not write "Understanding..." or "Learning..."). Ground every objective in what the deck actually teaches — never invent generic filler.

NEVER use an em dash (—) anywhere in any generated text; use a comma, period, or parentheses instead.

Return ONLY valid JSON. No explanation. No markdown.`;

const deckAnalysisResponseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    workshopTitle: { type: SchemaType.STRING, nullable: true },
    duration: { type: SchemaType.STRING, nullable: true },
    learningObjectives: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
  },
  required: ["workshopTitle", "duration", "learningObjectives"],
};

export async function analyzeDeck(slideTexts: string[]): Promise<DeckAnalysis> {
  const model = getClient().getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: deckAnalysisResponseSchema,
    },
  });

  const combinedText = slideTexts
    .map((text, index) => `Slide ${index + 1}:\n${text}`)
    .join("\n\n");

  const result = await model.generateContent([
    { text: DECK_ANALYZER_PROMPT },
    { text: `Deck OCR text:\n${combinedText}` },
  ]);

  const parsed = JSON.parse(result.response.text());

  // workshopTitle and duration are validated independently of learningObjectives
  // so that a good title/duration extraction is never discarded just because the
  // objectives array came back out of the expected 3-5 item range.
  const workshopTitleRaw = z.string().nullable().parse(parsed.workshopTitle);
  const durationRaw = z.string().nullable().parse(parsed.duration);
  const workshopTitle = workshopTitleRaw !== null ? stripEmDash(workshopTitleRaw) : null;
  const duration = durationRaw !== null ? stripEmDash(durationRaw) : null;

  let learningObjectives: string[];
  try {
    learningObjectives = z
      .array(z.string())
      .min(3)
      .max(5)
      .parse(parsed.learningObjectives)
      .map(stripEmDash);
  } catch {
    learningObjectives = [];
  }

  return { workshopTitle, duration, learningObjectives };
}
