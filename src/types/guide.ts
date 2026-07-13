export const SLIDE_INTENTS = [
  "WELCOME",
  "AGENDA",
  "LEARNING_OBJECTIVES",
  "SECTION_DIVIDER",
  "CONCEPT",
  "ARCHITECTURE",
  "DIAGRAM",
  "PROCESS",
  "WORKFLOW",
  "COMPARISON",
  "CODE",
  "DEMO",
  "EXERCISE",
  "CASE_STUDY",
  "SUMMARY",
  "KEY_TAKEAWAYS",
  "REFERENCE",
  "THANK_YOU",
  "APPENDIX",
  "OTHER",
] as const;
export type SlideIntent = (typeof SLIDE_INTENTS)[number];

export const SECTION_KEYS = [
  "trainerPointer",
  "mentalModel",
  "bestPractices",
  "commonPitfalls",
  "realWorldImplementation",
  "howThisFits",
  "faq",
  "keyTakeaways",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface SlideAnalysis {
  slideIntent: SlideIntent;
  recommendedSections: SectionKey[];
  confidence: number;
}

export interface GuideSectionItem {
  question: string;
  answer: string;
}

export interface GuideSection {
  type: string;
  title: string;
  content?: string;
  items?: GuideSectionItem[];
  keyPoints?: string[];
}

export interface InstructorGuide {
  sections: GuideSection[];
}

export const SECTION_TITLES: Record<string, string> = {
  trainerPointer: "Trainer Pointer",
  mentalModel: "Mental Model",
  bestPractices: "Best Practices",
  commonPitfalls: "Common Pitfalls",
  realWorldImplementation: "Real World Implementation",
  howThisFits: "Relevance of the Slide",
  faq: "Frequently Asked Questions by Learners",
  keyTakeaways: "Key Takeaways",
};

// Gemini always fills in its own `title` for every generated section (the response
// schema requires it), so it can't be trusted to reflect renames made to
// SECTION_TITLES here. Our canonical title always wins for known section types;
// Gemini's own title is only used as a fallback for a type we don't recognize.
export function sectionDisplayTitle(section: Pick<GuideSection, "type" | "title">): string {
  return SECTION_TITLES[section.type] || section.title || section.type;
}

export interface DeckAnalysis {
  workshopTitle: string | null;
  duration: string | null;
  learningObjectives: string[];
}
