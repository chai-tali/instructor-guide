import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { Schema } from "@google/generative-ai";
import { slideAnalysisSchema, instructorGuideSchema } from "@/lib/schemas";
import { SLIDE_INTENTS, SECTION_KEYS } from "@/types/guide";
import type { SlideAnalysis, InstructorGuide, SlideIntent, SectionKey } from "@/types/guide";

const MODEL_NAME = "gemini-1.5-flash";

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(apiKey);
}

const ANALYZER_PROMPT = `You are an expert Instructional Designer.

Your job is NOT to explain the slide.

Your job is ONLY to analyze the slide and determine what instructor guide content should be generated.

You will receive:
- Slide image
- OCR extracted text

STEP 1: Determine the slide's instructional intent. Choose exactly ONE value from the allowed slideIntent enum.

STEP 2: Determine which instructor guide sections are genuinely useful. Available sections are:
trainerPointer, whyItMatters, mentalModel, bestPractices, commonPitfalls, realWorldImplementation, howThisFits, faq, interviewQuestions.

Only recommend sections that genuinely improve teaching. Do NOT recommend sections simply because they exist.

Examples:
WELCOME -> trainerPointer
AGENDA -> trainerPointer
SECTION_DIVIDER -> trainerPointer
THANK_YOU -> (no sections)
SUMMARY -> trainerPointer
CONCEPT -> trainerPointer, whyItMatters, commonPitfalls, faq
ARCHITECTURE -> trainerPointer, whyItMatters, mentalModel, commonPitfalls, faq, interviewQuestions
PROCESS -> trainerPointer, whyItMatters, commonPitfalls, faq, interviewQuestions
CODE -> trainerPointer, bestPractices, commonPitfalls, faq, interviewQuestions
DEMO -> trainerPointer, bestPractices, commonPitfalls, faq
EXERCISE -> trainerPointer, bestPractices, faq

Interview Questions Rule: Recommend interviewQuestions ONLY if the slide teaches concepts that are commonly asked in technical or professional interviews. Do NOT recommend interviewQuestions for Welcome, Agenda, Section Divider, Summary, Thank You, or administrative slides.

FAQ Rule: Recommend FAQ only if learners are reasonably expected to ask clarification questions about the concept.

STEP 3: Estimate your confidence. Return a value between 0.0 and 1.0.

Return ONLY valid JSON. No explanation. No markdown.`;

const GENERATOR_PROMPT = `You are an expert Instructional Designer.

The slide has already been analyzed. Its instructional intent has already been determined.

Your task is ONLY to generate the instructor guide sections listed in recommendedSections. Generate NOTHING else.

Section Rules:

trainerPointer: Explain how the trainer should present this slide. Use action-oriented language. Maximum 120 words.

whyItMatters: 1-3 concise bullets. Explain why this concept matters. Ground every point in the slide.

mentalModel: Provide ONE memorable analogy. Only if a natural analogy exists. Do not force analogies.

bestPractices: Provide 1-3 delivery tips for the trainer. Focus on teaching technique.

commonPitfalls: Provide 1-3 learner misconceptions. These are mistakes learners commonly make while understanding this topic. NOT trainer mistakes.

realWorldImplementation: Provide 1-3 practical examples of how this concept is used in industry. Only if grounded in the slide.

howThisFits: Explain how this concept connects to the surrounding learning journey. Avoid generic statements like "This comes next."

faq: Generate 2-5 realistic learner questions. Each must include a question and an answer. Do not invent advanced questions.

interviewQuestions: Generate 2-4 interview questions ONLY if requested. These should represent realistic interview questions asked by hiring managers about the concepts taught on this slide. Do not generate trivia. Test conceptual understanding.

General Rules: Never invent information. Never generate generic filler. Generate ONLY the requested sections. Return ONLY valid JSON.`;

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
  },
  required: ["slideIntent", "recommendedSections", "confidence"],
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
  return slideAnalysisSchema.parse(parsed);
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
  return instructorGuideSchema.parse(parsed);
}
