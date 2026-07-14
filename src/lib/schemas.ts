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
