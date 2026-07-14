import { z } from "zod";
import { SLIDE_INTENTS, SECTION_KEYS, CONTENT_MODES } from "@/types/guide";

export const slideAnalysisSchema = z.object({
  slideIntent: z.enum(SLIDE_INTENTS),
  recommendedSections: z.array(z.enum(SECTION_KEYS)),
  confidence: z.number().min(0).max(1),
  slideTitle: z.string().nullable(),
});

export const guideSectionItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

export const guideSectionSchema = z.object({
  type: z.string(),
  title: z.string(),
  content: z.string().optional(),
  items: z.array(guideSectionItemSchema).optional(),
  keyPoints: z.array(z.string()).optional(),
});

export const instructorGuideSchema = z.object({
  sections: z.array(guideSectionSchema),
});

export const deckAnalysisSchema = z.object({
  workshopTitle: z.string().nullable(),
  duration: z.string().nullable(),
  learningObjectives: z.array(z.string()).min(3).max(5),
});

export const contentModeSchema = z.object({
  contentMode: z.enum(CONTENT_MODES),
});

export const studentGuideSchema = z.object({
  sections: z.array(guideSectionSchema),
});

// Raw Gemini response shape for a teaching-mode SG slide. selfProbingQuestions
// and rememberThis are required at the schema level (not just requested in the
// prompt) so Gemini's structured output mode cannot omit them the way it could
// when they were optional entries in a generic sections array.
export const sgTeachingResponseSchema = z.object({
  coreExplanationTitle: z.string(),
  coreExplanationContent: z.string(),
  rememberThis: z.array(z.string()).min(2).max(3),
  mentalModel: z.string().optional(),
  selfProbingQuestions: z.array(z.string()).min(2).max(3),
});

export const sgNonTeachingResponseSchema = z.object({
  coreExplanationTitle: z.string(),
  coreExplanationContent: z.string(),
});
