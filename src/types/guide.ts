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
  "REFERENCE",
  "THANK_YOU",
  "APPENDIX",
  "OTHER",
] as const;
export type SlideIntent = (typeof SLIDE_INTENTS)[number];

export const SECTION_KEYS = [
  "trainerPointer",
  "whyItMatters",
  "mentalModel",
  "bestPractices",
  "commonPitfalls",
  "realWorldImplementation",
  "howThisFits",
  "faq",
  "interviewQuestions",
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
}

export interface InstructorGuide {
  sections: GuideSection[];
}
