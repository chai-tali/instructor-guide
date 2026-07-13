# Instructor Guide: Merge Key Points into Trainer Pointer, Remove Interview Questions, Rename Relevance Heading

## Problem

The per-slide instructor guide currently generates up to nine independent section
types (`trainerPointer`, `whyItMatters`, `mentalModel`, `bestPractices`,
`commonPitfalls`, `realWorldImplementation`, `howThisFits`, `faq`,
`interviewQuestions`). The user wants three changes to this structure, based on
their reference instructor-guide document:

1. Remove the "Probing questions to Ask Learners" section (`interviewQuestions`)
   entirely — it should never be generated or rendered. "Frequently Asked
   Questions by Learners" (`faq`) is unaffected and stays.
2. What is currently a standalone "Why It Matters" section should instead be a
   "Key Points" sub-heading rendered directly under "Trainer Pointer" — 2-3
   bullets, generated together with the trainer pointer text as one combined
   unit, not as an independently recommended section.
3. Rename the `howThisFits` section's displayed heading from "How This Fits" to
   "Relevance of this Slide".

## Goals

- `interviewQuestions` is fully removed: not in `SECTION_KEYS`, not offered by
  the analyzer, never generated, never rendered (docx or web guide viewer).
- `whyItMatters` is fully removed as an independent section type. Its content
  is replaced by a `keyPoints: string[]` field on `trainerPointer` sections,
  containing 2-3 bullets explaining why the concept matters, generated
  automatically whenever `trainerPointer` is generated (no separate
  recommendation decision).
- Both `docx-export.ts` (Word export) and `SlideCard.tsx` (web guide viewer)
  render `keyPoints` as a "Key Points" sub-heading immediately under the
  Trainer Pointer's own heading/content, one heading level below it.
- `howThisFits`'s displayed title changes from "How This Fits" to "Relevance
  of this Slide" everywhere it's used (`SECTION_TITLES`, shared by both
  renderers) — no other behavior change to that section.

## Non-Goals

- No backfill/migration of already-generated guides in the database. Existing
  `Slide.sections` JSON with old `whyItMatters`/`interviewQuestions` entries is
  left as-is; it will render using its own stored `title` string as a harmless
  fallback (existing `section.title || SECTION_TITLES[section.type] ||
  section.type` pattern already handles unknown types gracefully). This only
  affects slides processed after this change ships.
- No code-level enforcement that `keyPoints` has exactly 2-3 items — prompt
  instruction only, consistent with this schema's existing tradeoff of not
  enum-constraining `type` either (a previously accepted, documented
  design choice in this codebase).
- No change to `faq` generation/rendering, and no change to any other section
  type (`mentalModel`, `bestPractices`, `commonPitfalls`,
  `realWorldImplementation`).

## Architecture

### Types (`src/types/guide.ts`)

`SECTION_KEYS` shrinks from nine to seven entries:

```ts
export const SECTION_KEYS = [
  "trainerPointer",
  "mentalModel",
  "bestPractices",
  "commonPitfalls",
  "realWorldImplementation",
  "howThisFits",
  "faq",
] as const;
```

`GuideSection` gains an optional field:

```ts
export interface GuideSection {
  type: string;
  title: string;
  content?: string;
  items?: GuideSectionItem[];
  keyPoints?: string[];
}
```

`SECTION_TITLES` drops the two removed keys and renames `howThisFits`:

```ts
export const SECTION_TITLES: Record<string, string> = {
  trainerPointer: "Trainer Pointer",
  mentalModel: "Mental Model",
  bestPractices: "Best Practices",
  commonPitfalls: "Common Pitfalls",
  realWorldImplementation: "Real World Implementation",
  howThisFits: "Relevance of this Slide",
  faq: "FAQ",
};
```

### Zod validation (`src/lib/schemas.ts`)

`guideSectionSchema` gains an optional `keyPoints` array:

```ts
export const guideSectionSchema = z.object({
  type: z.string(),
  title: z.string(),
  content: z.string().optional(),
  items: z.array(guideSectionItemSchema).optional(),
  keyPoints: z.array(z.string()).optional(),
});
```

No min/max length enforcement on `keyPoints` — matches this schema's existing
tradeoff on `type` not being enum-constrained (see `progress.md`'s Task 6 note
from a prior round: "reviewer flagged `guideSectionSchema.type` is `z.string()`
not `z.enum(...)`... not a blocker"). Enforcing a strict count here would
reintroduce the same atomic-discard risk already fixed for deck-level analysis
in `analyzeDeck` — reject the whole section, or 1-2 slightly-off key points,
lose the perfectly good trainer pointer text along with it.

### Gemini prompts and schema (`src/lib/gemini.ts`)

`ANALYZER_PROMPT`: the "Available sections" list drops `whyItMatters` and
`interviewQuestions`:

```
trainerPointer, mentalModel, bestPractices, commonPitfalls, realWorldImplementation, howThisFits, faq.
```

All per-intent examples (`CONCEPT -> ...`, `ARCHITECTURE -> ...`, `PROCESS ->
...`, `CODE -> ...`) drop `whyItMatters`/`interviewQuestions` from their
recommended lists. The "Interview Questions Rule" paragraph is deleted
entirely. The "FAQ Rule" paragraph is unchanged.

`GENERATOR_PROMPT`: the `whyItMatters` and `interviewQuestions` rule
paragraphs are deleted. The `trainerPointer` rule is rewritten to:

```
trainerPointer: Explain how the trainer should present this slide. Use action-oriented language. Maximum 120 words. Also generate keyPoints: exactly 2-3 concise bullets explaining why this concept matters to learners. Ground every point in the slide — never invent generic filler.
```

`generatorResponseSchema` (the Gemini `responseSchema`, not zod): each section
object gains an optional `keyPoints` array property:

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

### Rendering — `src/lib/docx-export.ts`

`sectionToParagraphs(section: GuideSection): Paragraph[]` gains a new step
after the existing content/items rendering: if `section.keyPoints` is present
and non-empty, append a `HEADING_3` paragraph titled "Key Points" followed by
one bullet `Paragraph` per key point (reusing the existing `bulletParagraphs`
helper already defined in this file for the front-matter lists). The section's
own heading stays `HEADING_2` as today — "Key Points" renders one level below
it (`HEADING_3`), directly under the Trainer Pointer's own content, before any
subsequent section.

### Rendering — `src/components/SlideCard.tsx`

Inside the existing `sections.map(...)` block, after the `section.content`/
`section.items` rendering, add: if `section.keyPoints` is present and
non-empty, render an `<h4>Key Points</h4>` followed by a `<ul>` of `<li>` per
key point — one heading level below the section's own `<h3>`.

## Error Handling

- `keyPoints` absent or empty on any section (including `trainerPointer`) →
  simply nothing is rendered for it, matching the existing optional-field
  pattern already used for `content`/`items` in both renderers.
- Old stored `Slide.sections` JSON containing `whyItMatters`/
  `interviewQuestions` type strings (from before this change) → renders via
  the existing `section.title || SECTION_TITLES[section.type] ||
  section.type` fallback in both renderers; no crash, no special handling
  needed (already covered by existing code, not new).

## Testing

- `tests/lib/schemas.test.ts`: add a case validating `guideSectionSchema`
  accepts a `trainerPointer` section with `keyPoints: string[]`, and a case
  confirming `keyPoints` remains optional (a section without it still
  validates).
- `tests/lib/gemini.test.ts`: update the existing `generateGuide` mock/test to
  include `keyPoints` in a `trainerPointer` response and assert it round-trips
  into the returned `InstructorGuide`. Remove/replace any existing test
  fixtures that reference `whyItMatters`/`interviewQuestions` as
  `recommendedSections` values (they're no longer valid enum members and
  `slideAnalysisSchema.parse` would now reject them).
- `tests/lib/docx-export.test.ts`: add a case asserting a `trainerPointer`
  section with `keyPoints` renders a "Key Points" heading followed by the
  bullet text in `word/document.xml`; add a case confirming a `howThisFits`
  section renders the heading "Relevance of this Slide" (not "How This
  Fits"); confirm no output ever contains "Interview Questions" or "Probing
  questions".
- Confirmed via a repo-wide grep: only `tests/lib/gemini.test.ts` and
  `tests/lib/schemas.test.ts` reference `whyItMatters`/`interviewQuestions` as
  `SectionKey`/`recommendedSections` values (besides `src/lib/gemini.ts` and
  `src/types/guide.ts` themselves, which this change rewrites directly). Both
  test files must replace those values with a still-valid section key (e.g.
  `mentalModel`, `commonPitfalls`), since `slideAnalysisSchema`'s
  `recommendedSections` is `z.array(z.enum(SECTION_KEYS))` and will reject the
  removed values once they're gone from `SECTION_KEYS`.
