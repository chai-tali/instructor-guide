# Instructor Guide Section Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Interview Questions section, merge Why It Matters into a "Key Points" sub-heading rendered under Trainer Pointer, and rename the How This Fits heading to "Relevance of this Slide" — across the Gemini prompts, validation schemas, DOCX export, and web guide viewer.

**Architecture:** `SECTION_KEYS`/`SECTION_TITLES` shrink and rename in one shared types file. `GuideSection` gains an optional `keyPoints: string[]` field, populated only on `trainerPointer` sections by a rewritten Gemini generator prompt/schema. Both renderers (`docx-export.ts`, `SlideCard.tsx`) grow one small conditional block each to render `keyPoints` as a sub-heading immediately under Trainer Pointer's own content.

**Tech Stack:** TypeScript, `@google/generative-ai`, `zod` v4, `docx` v9.7.1, React (no component test infra exists in this repo), `vitest`.

## Global Constraints

- No code-level enforcement that `keyPoints` has exactly 2-3 items — prompt instruction only. Do not add `.min()`/`.max()` to the zod `keyPoints` field; this is a deliberate tradeoff to avoid discarding a good `trainerPointer` over a slightly-off key-points count (same reasoning as this codebase's existing, accepted `guideSectionSchema.type` not being enum-constrained).
- `interviewQuestions` and `whyItMatters` must be removed entirely from `SECTION_KEYS` — not deprecated, not kept-but-unused. Any existing test fixture referencing them as a `recommendedSections` value must be updated to a different, still-valid section key (e.g. `mentalModel`), since `slideAnalysisSchema.recommendedSections` is `z.array(z.enum(SECTION_KEYS))` and will reject removed values.
- No backfill/migration of already-generated `Slide.sections` JSON in the database — this only affects slides processed after this change ships. Old stored data with removed section types renders via the existing `section.title || SECTION_TITLES[section.type] || section.type` fallback already present in both renderers; do not add special-case handling for it.
- `SlideCard.tsx` has no existing test coverage in this repo (`vitest.config.ts` runs with `environment: "node"`, no jsdom/`@testing-library/react` installed) — do not add new test infrastructure for this change. The `SlideCard.tsx` task is a direct mirror of the tested `docx-export.ts` logic; verify it via `tsc`/`lint` only, consistent with the rest of this file's existing (untested) state.

---

### Task 1: Update section types (remove whyItMatters/interviewQuestions, add keyPoints, rename howThisFits title)

**Files:**
- Modify: `src/types/guide.ts` (full `SECTION_KEYS`, `GuideSection`, `SECTION_TITLES` blocks)
- Modify: `tests/lib/schemas.test.ts:8` (fixture using a now-removed section key)
- Modify: `tests/lib/gemini.test.ts:30,39` (fixtures using a now-removed section key)

**Interfaces:**
- Produces: `SECTION_KEYS` (7 entries, `whyItMatters`/`interviewQuestions` removed), `GuideSection.keyPoints?: string[]`, `SECTION_TITLES.howThisFits === "Relevance of this Slide"`. Consumed by every later task in this plan.

- [ ] **Step 1: Make the types change**

Replace the full contents of `src/types/guide.ts`:

```ts
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
  "mentalModel",
  "bestPractices",
  "commonPitfalls",
  "realWorldImplementation",
  "howThisFits",
  "faq",
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
  howThisFits: "Relevance of this Slide",
  faq: "FAQ",
};

export interface DeckAnalysis {
  workshopTitle: string | null;
  duration: string | null;
  learningObjectives: string[];
}
```

- [ ] **Step 2: Run the full suite to confirm the expected breakage**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run`
Expected: exactly 2 failures —
- `tests/lib/schemas.test.ts > slideAnalysisSchema > accepts a valid analysis payload` (uses `"whyItMatters"` in `recommendedSections`, no longer a valid enum member)
- `tests/lib/gemini.test.ts > analyzeSlide > parses a valid analyzer response` (same reason)

- [ ] **Step 3: Fix the two broken fixtures**

In `tests/lib/schemas.test.ts`, line 8, change:
```ts
      recommendedSections: ["trainerPointer", "whyItMatters"],
```
to:
```ts
      recommendedSections: ["trainerPointer", "mentalModel"],
```

In `tests/lib/gemini.test.ts`, lines 30 and 39, change both occurrences of:
```ts
            recommendedSections: ["trainerPointer", "whyItMatters"],
```
and
```ts
    expect(result.recommendedSections).toEqual(["trainerPointer", "whyItMatters"]);
```
to:
```ts
            recommendedSections: ["trainerPointer", "mentalModel"],
```
and
```ts
    expect(result.recommendedSections).toEqual(["trainerPointer", "mentalModel"]);
```

- [ ] **Step 4: Run the full suite to confirm it's green**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run`
Expected: all test files pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/types/guide.ts tests/lib/schemas.test.ts tests/lib/gemini.test.ts
git commit -m "Remove whyItMatters/interviewQuestions section keys, add keyPoints field, rename howThisFits title"
```

---

### Task 2: Add keyPoints to the zod validation schema

**Files:**
- Modify: `src/lib/schemas.ts` (`guideSectionSchema`)
- Test: `tests/lib/schemas.test.ts`, `tests/lib/gemini.test.ts`

**Interfaces:**
- Consumes: `GuideSection.keyPoints` from Task 1.
- Produces: `guideSectionSchema` validates an optional `keyPoints: string[]` field, consumed by `instructorGuideSchema.parse` inside `generateGuide`. This is the task where `keyPoints` becomes end-to-end functional — Task 3 only changes prompt/schema text asking Gemini to produce it, it doesn't change how the response is validated.

- [ ] **Step 1: Write the failing test**

Append to the `describe("instructorGuideSchema", ...)` block in `tests/lib/schemas.test.ts` (after the existing `it("rejects a section missing required fields", ...)` case, before the block's closing `});`):

```ts

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
```

Also append to the `describe("generateGuide", ...)` block in `tests/lib/gemini.test.ts` (after the existing `it("parses a valid generator response", ...)` case, before the block's closing `});`) — this exercises the same `keyPoints` passthrough end-to-end through `generateGuide`'s `instructorGuideSchema.parse` call, not just the schema in isolation:

```ts

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/schemas.test.ts tests/lib/gemini.test.ts`
Expected: FAIL on all 3 new cases — `result.sections[0].keyPoints` is `undefined` in each, because `guideSectionSchema` doesn't parse/pass through a `keyPoints` field yet (zod strips unknown keys by default), so every `toEqual([...])`/`toBeUndefined()` assertion involving it fails or passes for the wrong reason. Confirm the two schema-level cases and the one gemini-level case all fail before proceeding.

- [ ] **Step 3: Add keyPoints to guideSectionSchema**

In `src/lib/schemas.ts`, replace:

```ts
export const guideSectionSchema = z.object({
  type: z.string(),
  title: z.string(),
  content: z.string().optional(),
  items: z.array(guideSectionItemSchema).optional(),
});
```

with:

```ts
export const guideSectionSchema = z.object({
  type: z.string(),
  title: z.string(),
  content: z.string().optional(),
  items: z.array(guideSectionItemSchema).optional(),
  keyPoints: z.array(z.string()).optional(),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/schemas.test.ts tests/lib/gemini.test.ts`
Expected: PASS (all cases, including the 3 new ones — 2 in `schemas.test.ts`, 1 in `gemini.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas.ts tests/lib/schemas.test.ts tests/lib/gemini.test.ts
git commit -m "Add optional keyPoints field to guideSectionSchema"
```

---

### Task 3: Rewrite Gemini prompts and response schema

**Files:**
- Modify: `src/lib/gemini.ts` (`ANALYZER_PROMPT`, `GENERATOR_PROMPT`, `generatorResponseSchema`)

**Interfaces:**
- Consumes: nothing new from earlier tasks — this task only changes prompt text (instructing Gemini what to generate) and the Gemini-SDK-side `responseSchema` (constraining what the model is allowed to return). Task 2 already made `keyPoints` validate and pass through end-to-end via mocked-response tests; those tests don't exercise the actual prompt text or Gemini-side schema, since the test mock bypasses Gemini's own schema enforcement entirely.
- Produces: no new testable interface — this task is prompt engineering only. Verify via full-suite-green + reading the diff, not a new failing test (this codebase has never unit-tested prompt text content, including before this change — `ANALYZER_PROMPT`/`GENERATOR_PROMPT` are private constants with no direct test coverage of their string content).

- [ ] **Step 1: Update ANALYZER_PROMPT, GENERATOR_PROMPT, and generatorResponseSchema**

In `src/lib/gemini.ts`, replace the `ANALYZER_PROMPT` constant with:

```ts
const ANALYZER_PROMPT = `You are an expert Instructional Designer.

Your job is NOT to explain the slide.

Your job is ONLY to analyze the slide and determine what instructor guide content should be generated.

You will receive:
- Slide image
- OCR extracted text

STEP 1: Determine the slide's instructional intent. Choose exactly ONE value from the allowed slideIntent enum.

STEP 2: Determine which instructor guide sections are genuinely useful. Available sections are:
trainerPointer, mentalModel, bestPractices, commonPitfalls, realWorldImplementation, howThisFits, faq.

Only recommend sections that genuinely improve teaching. Do NOT recommend sections simply because they exist.

Examples:
WELCOME -> trainerPointer
AGENDA -> trainerPointer
SECTION_DIVIDER -> trainerPointer
THANK_YOU -> (no sections)
SUMMARY -> trainerPointer
CONCEPT -> trainerPointer, commonPitfalls, faq
ARCHITECTURE -> trainerPointer, mentalModel, commonPitfalls, faq
PROCESS -> trainerPointer, commonPitfalls, faq
CODE -> trainerPointer, bestPractices, commonPitfalls, faq
DEMO -> trainerPointer, bestPractices, commonPitfalls, faq
EXERCISE -> trainerPointer, bestPractices, faq

FAQ Rule: Recommend FAQ only if learners are reasonably expected to ask clarification questions about the concept.

STEP 3: Estimate your confidence. Return a value between 0.0 and 1.0.

Return ONLY valid JSON. No explanation. No markdown.`;
```

Replace the `GENERATOR_PROMPT` constant with:

```ts
const GENERATOR_PROMPT = `You are an expert Instructional Designer.

The slide has already been analyzed. Its instructional intent has already been determined.

Your task is ONLY to generate the instructor guide sections listed in recommendedSections. Generate NOTHING else.

Section Rules:

trainerPointer: Explain how the trainer should present this slide. Use action-oriented language. Maximum 120 words. Also generate keyPoints: exactly 2-3 concise bullets explaining why this concept matters to learners. Ground every point in the slide — never invent generic filler.

mentalModel: Provide ONE memorable analogy. Only if a natural analogy exists. Do not force analogies.

bestPractices: Provide 1-3 delivery tips for the trainer. Focus on teaching technique.

commonPitfalls: Provide 1-3 learner misconceptions. These are mistakes learners commonly make while understanding this topic. NOT trainer mistakes.

realWorldImplementation: Provide 1-3 practical examples of how this concept is used in industry. Only if grounded in the slide.

howThisFits: Explain how this concept connects to the surrounding learning journey. Avoid generic statements like "This comes next."

faq: Generate 2-5 realistic learner questions. Each must include a question and an answer. Do not invent advanced questions.

General Rules: Never invent information. Never generate generic filler. Generate ONLY the requested sections. Return ONLY valid JSON.`;
```

Replace the `generatorResponseSchema` constant with:

```ts
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
```

- [ ] **Step 2: Run the full suite**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run`
Expected: all test files pass, 0 failures — this task changes prompt text and the Gemini-side response schema only, neither of which any existing test asserts on directly, so this run should be a pure no-regression confirmation, not a new pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/gemini.ts tests/lib/gemini.test.ts
git commit -m "Drop whyItMatters/interviewQuestions from Gemini prompts, add keyPoints to trainerPointer generation"
```

---

### Task 4: Render Key Points under Trainer Pointer in the DOCX export

**Files:**
- Modify: `src/lib/docx-export.ts` (`sectionToParagraphs`)
- Test: `tests/lib/docx-export.test.ts`

**Interfaces:**
- Consumes: `GuideSection.keyPoints` (Task 1), `SECTION_TITLES.howThisFits` renamed (Task 1).
- Produces: no new exports — `sectionToParagraphs` (not exported) gains new rendering behavior, exercised through the existing exported `buildInstructorGuideDocx`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe("buildInstructorGuideDocx front matter", ...)` block in `tests/lib/docx-export.test.ts` (after the existing `it("renders a Session Guide heading before the per-slide content", ...)` case, before the block's closing `});`):

```ts

  it("renders a Key Points sub-heading with bullets under Trainer Pointer", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [
      fakeSlide({
        sections: JSON.stringify([
          {
            type: "trainerPointer",
            title: "Trainer Pointer",
            content: "Welcome the class.",
            keyPoints: ["Sets a collaborative tone.", "Establishes the agenda."],
          },
        ]),
      }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Key Points");
    expect(xml).toContain("Sets a collaborative tone.");
    expect(xml).toContain("Establishes the agenda.");
  });

  it("does not render a Key Points heading when trainerPointer has no keyPoints", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [
      fakeSlide({
        sections: JSON.stringify([
          { type: "trainerPointer", title: "Trainer Pointer", content: "Welcome the class." },
        ]),
      }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).not.toContain("Key Points");
  });

  it("renders the Relevance of this Slide heading for a howThisFits section", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [
      fakeSlide({
        sections: JSON.stringify([
          { type: "howThisFits", title: "", content: "This slide connects to the next module." },
        ]),
      }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Relevance of this Slide");
    expect(xml).not.toContain("How This Fits");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/docx-export.test.ts`
Expected: FAIL — the "Key Points" test fails because `sectionToParagraphs` doesn't render `keyPoints` yet (the other two tests should already pass, since Task 1 already renamed `SECTION_TITLES.howThisFits` and `keyPoints` absence already renders nothing — confirm the actual failing test is only the first new one, and note in your report if more than expected fail).

- [ ] **Step 3: Render keyPoints in sectionToParagraphs**

In `src/lib/docx-export.ts`, replace the `sectionToParagraphs` function:

```ts
function sectionToParagraphs(section: GuideSection): Paragraph[] {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun(section.title || SECTION_TITLES[section.type] || section.type)],
    }),
  ];

  if (section.content) {
    paragraphs.push(...markdownBlocksToParagraphs(parseMarkdownLite(section.content)));
  }

  if (section.items) {
    for (const item of section.items) {
      if (item.question !== "bullet") {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: `${item.question}: `, bold: true })],
          })
        );
      }
      paragraphs.push(...markdownBlocksToParagraphs(parseMarkdownLite(item.answer)));
    }
  }

  if (section.keyPoints && section.keyPoints.length > 0) {
    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("Key Points")],
      })
    );
    paragraphs.push(...bulletParagraphs(section.keyPoints));
  }

  return paragraphs;
}
```

(only the new `if (section.keyPoints...)` block before the final `return paragraphs;` is added — everything else in the function is unchanged)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/docx-export.test.ts`
Expected: PASS (all cases, including the 3 new ones)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run`
Expected: all test files pass, 0 failures.

Run: `npx tsc --noEmit`
Expected: no output, exit code 0

- [ ] **Step 6: Commit**

```bash
git add src/lib/docx-export.ts tests/lib/docx-export.test.ts
git commit -m "Render Key Points sub-heading under Trainer Pointer in the DOCX export"
```

---

### Task 5: Render Key Points under Trainer Pointer in the web guide viewer

**Files:**
- Modify: `src/components/SlideCard.tsx`

**Interfaces:**
- Consumes: `GuideSection.keyPoints` (Task 1).
- Produces: no new exports — `SlideCard` renders `keyPoints` when present, mirroring Task 4's DOCX behavior. No test coverage (see Global Constraints — this repo has no component test infrastructure).

- [ ] **Step 1: Add keyPoints rendering**

In `src/components/SlideCard.tsx`, replace:

```tsx
      {sections.map((section) => (
        <div key={section.type}>
          <h3>{section.title || SECTION_TITLES[section.type] || section.type}</h3>
          {section.content && <ReactMarkdown>{section.content}</ReactMarkdown>}
          {section.items && (
            <ul>
              {section.items.map((item, i) => (
                <li key={i}>
                  {item.question !== "bullet" && <strong>{item.question}: </strong>}
                  <ReactMarkdown>{item.answer}</ReactMarkdown>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
```

with:

```tsx
      {sections.map((section) => (
        <div key={section.type}>
          <h3>{section.title || SECTION_TITLES[section.type] || section.type}</h3>
          {section.content && <ReactMarkdown>{section.content}</ReactMarkdown>}
          {section.items && (
            <ul>
              {section.items.map((item, i) => (
                <li key={i}>
                  {item.question !== "bullet" && <strong>{item.question}: </strong>}
                  <ReactMarkdown>{item.answer}</ReactMarkdown>
                </li>
              ))}
            </ul>
          )}
          {section.keyPoints && section.keyPoints.length > 0 && (
            <>
              <h4>Key Points</h4>
              <ul>
                {section.keyPoints.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ))}
```

- [ ] **Step 2: Run the full suite and typecheck**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run`
Expected: all test files pass, 0 failures (this component has no direct test coverage, so no new test results are expected from this change — this run only confirms no regression elsewhere).

Run: `npx tsc --noEmit`
Expected: no output, exit code 0

Run: `npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/SlideCard.tsx
git commit -m "Render Key Points sub-heading under Trainer Pointer in the web guide viewer"
```
