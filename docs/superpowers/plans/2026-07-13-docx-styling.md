# DOCX Front-Matter Styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the generated instructor-guide `.docx` to include a Workshop Title, Duration (blank if not stated in the deck), deck-wide Learning Objectives, and static Trainer Guidelines / Material Required / Training Aids / Training videos sections, ahead of the existing per-slide "Session Guide" content.

**Architecture:** One new deck-level Gemini call (`analyzeDeck`) runs once per job in the existing worker pipeline and persists `workshopTitle`/`duration`/`learningObjectives` on the `Job` row. A new static-data module holds the never-generated Trainer Guidelines/Material/Training Aids/Videos content verbatim from the reference document. `docx-export.ts` is restructured to render both in front of the unchanged per-slide sections.

**Tech Stack:** TypeScript, Next.js 14 API routes, `pg` (raw Postgres), `@google/generative-ai`, `zod` v4, `docx` v9.7.1, `vitest`.

## Global Constraints

- Use zod v4 API syntax (project is pinned to `zod@^4.4.3`) — `z.object`/`z.enum`/`z.array` etc. work as in existing `src/lib/schemas.ts`.
- Verify any new `docx` API usage (`Table`, `TableRow`, `TableCell`, `WidthType`) against `node_modules/docx/dist/index.d.ts` if unsure of an option name — the installed version is `9.7.1`.
- Do not add code-level enforcement of the "objectives must start with a non-gerund verb" rule — prompt instruction only, per explicit user decision during design.
- Do not build any UI for editing the static Trainer Guidelines/Material/Training Aids/Videos content — it is a hardcoded TypeScript module, edited via code change + redeploy like any other constant in this codebase.
- A failure in the new deck-level analysis (`analyzeDeck`) must never fail the whole job — catch it in `worker.ts` and continue, matching the existing per-slide failure-isolation pattern (`processSlide`'s try/catch).
- `schema.sql` changes must remain idempotent against an already-migrated database: use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, not a bare `ALTER TABLE ... ADD COLUMN`, since `scripts/migrate.mjs` re-runs the whole file's SQL text on every `pretest`/`db:migrate` invocation.
- Run tests against the local Postgres test database using the same connection string the repo's `pretest`/`test` npm scripts use: `postgresql://postgres:postgres@localhost:5432/instructor_guide_test`. Apply schema changes to it first with `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test node scripts/migrate.mjs` before running any test that depends on the new columns.

---

### Task 1: Database schema — workshopTitle/duration/learningObjectives on Job

**Files:**
- Modify: `src/lib/schema.sql`
- Modify: `src/lib/db.ts:15-24` (`JobRow` interface)
- Test: `tests/lib/db.test.ts` (new file)

**Interfaces:**
- Produces: `JobRow` gains `workshopTitle: string | null`, `duration: string | null`, `learningObjectives: string | null` (JSON-encoded `string[]`). `db.job.create`/`db.job.update` need no signature changes — Postgres defaults omitted columns to `NULL`, and `db.job.update`'s existing `buildSetClause` already accepts arbitrary partial data.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";

describe("db.job workshop fields", () => {
  afterAll(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
  });

  it("defaults workshopTitle/duration/learningObjectives to null on create", async () => {
    const job = await db.job.create({ filename: "deck.pptx" });
    expect(job.workshopTitle).toBeNull();
    expect(job.duration).toBeNull();
    expect(job.learningObjectives).toBeNull();
  });

  it("round-trips workshopTitle/duration/learningObjectives through update", async () => {
    const job = await db.job.create({ filename: "deck.pptx" });
    const updated = await db.job.update({
      where: { id: job.id },
      data: {
        workshopTitle: "AI in Practice",
        duration: "2 hours",
        learningObjectives: JSON.stringify(["Understand X", "Apply Y"]),
      },
    });
    expect(updated.workshopTitle).toBe("AI in Practice");
    expect(updated.duration).toBe("2 hours");
    expect(JSON.parse(updated.learningObjectives!)).toEqual(["Understand X", "Apply Y"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/db.test.ts`
Expected: FAIL — `job.workshopTitle` is `undefined` (property doesn't exist on the row / TypeScript error if checked, or the row simply lacks the field, causing the `toBeNull()`/`toBe(...)` assertions to fail).

- [ ] **Step 3: Update schema.sql**

Replace the full contents of `src/lib/schema.sql` with:

```sql
CREATE TABLE IF NOT EXISTS "Job" (
    "id" TEXT PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalSlides" INTEGER,
    "completedSlides" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "workshopTitle" TEXT,
    "duration" TEXT,
    "learningObjectives" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Slide" (
    "id" TEXT PRIMARY KEY,
    "jobId" TEXT NOT NULL REFERENCES "Job"("id"),
    "index" INTEGER NOT NULL,
    "imagePath" TEXT NOT NULL,
    "extractedText" TEXT NOT NULL,
    "slideIntent" TEXT,
    "recommendedSections" TEXT,
    "confidence" DOUBLE PRECISION,
    "sections" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    UNIQUE ("jobId", "index")
);

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "workshopTitle" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "duration" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "learningObjectives" TEXT;
```

- [ ] **Step 4: Update JobRow in db.ts**

In `src/lib/db.ts`, replace lines 15-24:

```ts
export interface JobRow {
  id: string;
  filename: string;
  status: string;
  totalSlides: number | null;
  completedSlides: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

with:

```ts
export interface JobRow {
  id: string;
  filename: string;
  status: string;
  totalSlides: number | null;
  completedSlides: number;
  error: string | null;
  workshopTitle: string | null;
  duration: string | null;
  learningObjectives: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 5: Apply the migration to the test database**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test node scripts/migrate.mjs`
Expected: `Migration applied.`

- [ ] **Step 6: Run test to verify it passes**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/db.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Run full suite to confirm no regressions**

Run: `npm test`
Expected: all existing test files still pass (schema change is additive/nullable, no existing code references the new columns yet)

- [ ] **Step 8: Commit**

```bash
git add src/lib/schema.sql src/lib/db.ts tests/lib/db.test.ts
git commit -m "Add workshopTitle/duration/learningObjectives columns to Job"
```

---

### Task 2: Types and Zod schema for deck-level analysis

**Files:**
- Modify: `src/types/guide.ts`
- Modify: `src/lib/schemas.ts`
- Test: `tests/lib/schemas.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `DeckAnalysis` interface (`{ workshopTitle: string | null; duration: string | null; learningObjectives: string[] }`) and `deckAnalysisSchema` (zod), both consumed by Task 3's `analyzeDeck`.

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/schemas.test.ts`:

```ts
import { deckAnalysisSchema } from "@/lib/schemas";
```

(add this import alongside the existing `import { slideAnalysisSchema, instructorGuideSchema } from "@/lib/schemas";` line — combine into one import statement)

Then append this describe block at the end of the file:

```ts
describe("deckAnalysisSchema", () => {
  it("accepts a full deck analysis payload", () => {
    const result = deckAnalysisSchema.parse({
      workshopTitle: "AI in Practice",
      duration: "4:00 PM to 6:30 PM",
      learningObjectives: [
        "Understand the five-block prompt architecture",
        "Apply structured prompts to extract financial data",
        "Identify common LLM hallucination risks",
      ],
    });
    expect(result.workshopTitle).toBe("AI in Practice");
    expect(result.learningObjectives).toHaveLength(3);
  });

  it("accepts null workshopTitle and duration", () => {
    const result = deckAnalysisSchema.parse({
      workshopTitle: null,
      duration: null,
      learningObjectives: ["Understand X", "Apply Y", "Identify Z"],
    });
    expect(result.workshopTitle).toBeNull();
    expect(result.duration).toBeNull();
  });

  it("rejects fewer than 3 learning objectives", () => {
    expect(() =>
      deckAnalysisSchema.parse({
        workshopTitle: null,
        duration: null,
        learningObjectives: ["Understand X"],
      })
    ).toThrow();
  });

  it("rejects more than 5 learning objectives", () => {
    expect(() =>
      deckAnalysisSchema.parse({
        workshopTitle: null,
        duration: null,
        learningObjectives: ["A", "B", "C", "D", "E", "F"],
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/schemas.test.ts`
Expected: FAIL — `deckAnalysisSchema` is not exported from `@/lib/schemas`.

- [ ] **Step 3: Add DeckAnalysis type**

In `src/types/guide.ts`, append at the end of the file:

```ts

export interface DeckAnalysis {
  workshopTitle: string | null;
  duration: string | null;
  learningObjectives: string[];
}
```

- [ ] **Step 4: Add deckAnalysisSchema**

In `src/lib/schemas.ts`, append at the end of the file:

```ts

export const deckAnalysisSchema = z.object({
  workshopTitle: z.string().nullable(),
  duration: z.string().nullable(),
  learningObjectives: z.array(z.string()).min(3).max(5),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/schemas.test.ts`
Expected: PASS (all cases in `slideAnalysisSchema`, `instructorGuideSchema`, and the new `deckAnalysisSchema` describe blocks)

- [ ] **Step 6: Commit**

```bash
git add src/types/guide.ts src/lib/schemas.ts tests/lib/schemas.test.ts
git commit -m "Add DeckAnalysis type and deckAnalysisSchema"
```

---

### Task 3: Gemini deck-level analysis call

**Files:**
- Modify: `src/lib/gemini.ts`
- Test: `tests/lib/gemini.test.ts`

**Interfaces:**
- Consumes: `deckAnalysisSchema` from `@/lib/schemas` (Task 2), `DeckAnalysis` from `@/types/guide` (Task 2).
- Produces: `export async function analyzeDeck(slideTexts: string[]): Promise<DeckAnalysis>`, consumed by Task 4's `worker.ts`.

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/gemini.test.ts` (add `analyzeDeck` to the existing `import { analyzeSlide, generateGuide } from "@/lib/gemini";` line, then append this describe block at the end of the file):

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/gemini.test.ts`
Expected: FAIL — `analyzeDeck` is not exported from `@/lib/gemini`.

- [ ] **Step 3: Implement analyzeDeck**

In `src/lib/gemini.ts`, add this import to the top-of-file imports (alongside the existing `slideAnalysisSchema, instructorGuideSchema` import and `SlideAnalysis, InstructorGuide, SlideIntent, SectionKey` type import):

```ts
import { slideAnalysisSchema, instructorGuideSchema, deckAnalysisSchema } from "@/lib/schemas";
import type { SlideAnalysis, InstructorGuide, SlideIntent, SectionKey, DeckAnalysis } from "@/types/guide";
```

Then append at the end of `src/lib/gemini.ts`:

```ts

const DECK_ANALYZER_PROMPT = `You are an expert Instructional Designer.

You will receive the OCR-extracted text of every slide in a training deck, in order.

Your job is to analyze the WHOLE deck (not one slide) and extract three things:

1. workshopTitle: The workshop/session title, ONLY if a slide explicitly states one (e.g. on a title or welcome slide). If no slide explicitly states a title, return null. Do not invent or infer a title from the general topic.

2. duration: An explicit statement of the total workshop/session duration or time schedule (e.g. "2 hours", "9:30 AM to 5:00 PM", "Day 1 and Day 2"), ONLY if a slide explicitly states one. If no slide explicitly states a duration or schedule, return null. NEVER estimate or infer a duration from slide count or content.

3. learningObjectives: Generate 3 to 5 learning objectives for the ENTIRE deck (not per-slide). Each objective MUST start with an imperative, base-form verb such as Understand, Apply, Identify, Explain, Analyze, Evaluate, Describe, Create, or Demonstrate. NEVER start an objective with a gerund/"-ing" form (do not write "Understanding..." or "Learning..."). Ground every objective in what the deck actually teaches — never invent generic filler.

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
  return deckAnalysisSchema.parse(parsed);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/gemini.test.ts`
Expected: PASS (`analyzeSlide`, `generateGuide`, and the new `analyzeDeck` describe blocks all pass)

- [ ] **Step 5: Commit**

```bash
git add src/lib/gemini.ts tests/lib/gemini.test.ts
git commit -m "Add analyzeDeck Gemini call for deck-level title/duration/objectives"
```

---

### Task 4: Wire analyzeDeck into the worker pipeline

**Files:**
- Modify: `src/lib/worker.ts:1-66`
- Test: `tests/lib/worker.test.ts`

**Interfaces:**
- Consumes: `analyzeDeck` from `@/lib/gemini` (Task 3).
- Produces: `Job` rows populated with `workshopTitle`/`duration`/`learningObjectives` after `processJob` completes (used by Task 7's export route via the existing `db.job.findUnique`).

- [ ] **Step 1: Write the failing test**

In `tests/lib/worker.test.ts`, update the existing `vi.mock("@/lib/gemini", ...)` block (currently only mocking `analyzeSlide`/`generateGuide`) to also mock `analyzeDeck`:

```ts
vi.mock("@/lib/gemini", () => ({
  analyzeSlide: vi.fn(),
  generateGuide: vi.fn(),
  analyzeDeck: vi.fn(),
}));
```

Update the import line to include `analyzeDeck`:

```ts
import { analyzeSlide, generateGuide, analyzeDeck } from "@/lib/gemini";
```

Add `vi.mocked(analyzeDeck).mockReset();` to the `beforeEach` block, alongside the existing three `.mockReset()` calls.

Then append this new test at the end of the `describe("processJob", ...)` block (before its closing `});`):

```ts

  it("persists workshopTitle, duration, and learningObjectives from analyzeDeck", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "pending" });
    const slidesDir = path.join(tmpDir, job.id, "slides");
    await fs.mkdir(slidesDir, { recursive: true });
    await fs.writeFile(path.join(slidesDir, "1.png"), Buffer.from("fake-png"));

    vi.mocked(convertPptxToSlideImages).mockResolvedValue(1);
    vi.mocked(extractSlideTexts).mockResolvedValue(["Welcome to AI in Practice"]);
    vi.mocked(analyzeDeck).mockResolvedValue({
      workshopTitle: "AI in Practice",
      duration: "4:00 PM to 6:30 PM",
      learningObjectives: ["Understand prompting", "Apply structured prompts", "Identify pitfalls"],
    });
    vi.mocked(analyzeSlide).mockResolvedValue({
      slideIntent: "WELCOME",
      recommendedSections: ["trainerPointer"],
      confidence: 0.9,
    });
    vi.mocked(generateGuide).mockResolvedValue({
      sections: [{ type: "trainerPointer", title: "Trainer Pointer", content: "Welcome them." }],
    });

    await processJob(job.id);

    const updated = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.workshopTitle).toBe("AI in Practice");
    expect(updated.duration).toBe("4:00 PM to 6:30 PM");
    expect(JSON.parse(updated.learningObjectives!)).toEqual([
      "Understand prompting",
      "Apply structured prompts",
      "Identify pitfalls",
    ]);
  });

  it("still completes the job when analyzeDeck fails", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "pending" });
    const slidesDir = path.join(tmpDir, job.id, "slides");
    await fs.mkdir(slidesDir, { recursive: true });
    await fs.writeFile(path.join(slidesDir, "1.png"), Buffer.from("fake-png"));

    vi.mocked(convertPptxToSlideImages).mockResolvedValue(1);
    vi.mocked(extractSlideTexts).mockResolvedValue(["Some slide text"]);
    vi.mocked(analyzeDeck).mockRejectedValue(new Error("Gemini timeout"));
    vi.mocked(analyzeSlide).mockResolvedValue({
      slideIntent: "CONCEPT",
      recommendedSections: ["trainerPointer"],
      confidence: 0.9,
    });
    vi.mocked(generateGuide).mockResolvedValue({
      sections: [{ type: "trainerPointer", title: "Trainer Pointer", content: "Explain it." }],
    });

    await processJob(job.id);

    const updated = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe("done");
    expect(updated.workshopTitle).toBeNull();
    expect(updated.duration).toBeNull();
    expect(updated.learningObjectives).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/worker.test.ts`
Expected: FAIL — `analyzeDeck` mock is called/asserted but `processJob` never calls it, so `updated.workshopTitle` stays `null` in the first new test (assertion fails expecting `"AI in Practice"`).

- [ ] **Step 3: Implement the worker integration**

In `src/lib/worker.ts`, update the import line:

```ts
import { analyzeSlide, generateGuide, analyzeDeck } from "@/lib/gemini";
```

Then in `processJob`, insert a new block right after the existing `totalSlides` update and before `const slideRecords = await Promise.all(...)`:

```ts
    await db.job.update({ where: { id: jobId }, data: { totalSlides: slideCount } });

    try {
      const deckAnalysis = await analyzeDeck(texts);
      await db.job.update({
        where: { id: jobId },
        data: {
          workshopTitle: deckAnalysis.workshopTitle,
          duration: deckAnalysis.duration,
          learningObjectives: JSON.stringify(deckAnalysis.learningObjectives),
        },
      });
    } catch {
      // Deck-level analysis is best-effort: a failure here must not fail the whole
      // job. Export falls back to filename-as-title and blank duration/objectives.
    }

    const slideRecords = await Promise.all(
```

(the rest of `processJob` is unchanged — the existing `slideRecords`/`pLimit`/`Promise.all` block and the final `status: "done"` update stay exactly as they are)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/worker.test.ts`
Expected: PASS (all 4 tests in `describe("processJob", ...)`)

- [ ] **Step 5: Run full suite to confirm no regressions**

Run: `npm test`
Expected: all test files pass, including `tests/integration/pipeline.test.ts` (which exercises the real `soffice`-backed pipeline and will now also invoke the real `analyzeDeck` — if `GEMINI_API_KEY` is unset in this environment it will throw and be caught, leaving the new fields `null`, same as any other Gemini call failure in that test's environment)

- [ ] **Step 6: Commit**

```bash
git add src/lib/worker.ts tests/lib/worker.test.ts
git commit -m "Call analyzeDeck once per job and persist results to the Job row"
```

---

### Task 5: Static Trainer Guidelines / Material / Training Aids content module

**Files:**
- Create: `src/lib/static-guide-content.ts`
- Test: `tests/lib/static-guide-content.test.ts` (new file)

**Interfaces:**
- Produces: `TRAINER_GUIDELINES_DOS`, `TRAINER_GUIDELINES_DONTS`, `MATERIAL_REQUIRED_ITEMS`, `TRAINING_AIDS_ITEMS`, `TRAINING_VIDEO_ITEMS` (all `string[]`), consumed by Task 6's `docx-export.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/static-guide-content.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  TRAINER_GUIDELINES_DOS,
  TRAINER_GUIDELINES_DONTS,
  MATERIAL_REQUIRED_ITEMS,
  TRAINING_AIDS_ITEMS,
  TRAINING_VIDEO_ITEMS,
} from "@/lib/static-guide-content";

describe("static-guide-content", () => {
  it("exposes non-empty static lists for every front-matter section", () => {
    expect(TRAINER_GUIDELINES_DOS.length).toBeGreaterThan(0);
    expect(TRAINER_GUIDELINES_DONTS.length).toBeGreaterThan(0);
    expect(MATERIAL_REQUIRED_ITEMS.length).toBeGreaterThan(0);
    expect(TRAINING_AIDS_ITEMS.length).toBeGreaterThan(0);
    expect(TRAINING_VIDEO_ITEMS.length).toBeGreaterThan(0);
  });

  it("keeps Trainer Guidelines Do's at least as long as Don'ts, matching the reference table", () => {
    expect(TRAINER_GUIDELINES_DOS.length).toBeGreaterThanOrEqual(TRAINER_GUIDELINES_DONTS.length);
  });

  it("leaves Training Aids items blank after the colon for manual fill-in", () => {
    for (const item of TRAINING_AIDS_ITEMS) {
      expect(item.trim().endsWith(":")).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/static-guide-content.test.ts`
Expected: FAIL — Cannot find module `@/lib/static-guide-content`.

- [ ] **Step 3: Create the static content module**

Create `src/lib/static-guide-content.ts`:

```ts
export const TRAINER_GUIDELINES_DOS: string[] = [
  "Connect with the Client SPOC 1 day prior to the program to check training time 9:30 am",
  "Check the venue location on Google Maps one day prior to the workshop",
  "Report to the venue 30 – 40 min prior to session",
  "Check the connectivity of laptop and projector",
  "Check your presentation deck with audio/video tools",
  "Be well prepared for the workshop – Check Sony Checklist (Printouts needed for all participants)",
  "Engage with the participants",
  "Encourage participants to ask questions",
  "Follow the session plan and trainer guide for smooth execution of the program",
  "Recap at the end of the session",
  "Summarize key concepts covered",
  "Monitor program lines as per Day wise plan",
];

export const TRAINER_GUIDELINES_DONTS: string[] = [
  "Don't talk to the flip chart",
  "Don't ignore participant feedback & comments",
  "Don't get distracted by participants venting about internal issues",
  "Don't read from slides – engage with the participants",
];

export const MATERIAL_REQUIRED_ITEMS: string[] = [
  "Equipment and training material – Arranged by Sony",
  "Projector (Convertor for VGA and HDMI cable)",
  "Speakers – Audio",
  "Flipchart",
  "Chart Paper for Group activities",
  "4 - 5 packs of sketch pens for activities",
  "Sticky notes – 4 to 5 packs",
];

// Label lines only — left blank after the colon for manual fill-in, matching the reference doc.
export const TRAINING_AIDS_ITEMS: string[] = [
  "Link to PPT:",
  "Link to CheckList:",
  "Link to Attendance Sheet:",
  "Link to Post-session assessment (Taken on the last day of the workshop):",
  "Link to Post-session Feedback (Taken on the last day of the workshop):",
];

export const TRAINING_VIDEO_ITEMS: string[] = [
  "Link to TTT",
  "Link to TTT (Refresher)",
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/static-guide-content.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/static-guide-content.ts tests/lib/static-guide-content.test.ts
git commit -m "Add static Trainer Guidelines/Material/Training Aids content module"
```

---

### Task 6: Restructure docx-export.ts with the new front matter

**Files:**
- Modify: `src/lib/docx-export.ts` (full rewrite)
- Test: `tests/lib/docx-export.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `JobRow` from `@/lib/db` (Task 1), static content from `@/lib/static-guide-content` (Task 5).
- Produces: `buildInstructorGuideDocx(job: JobRow, slides: SlideRow[]): Promise<Buffer>` — **signature change** from the current `buildInstructorGuideDocx(slides: SlideRow[], title: string): Promise<Buffer>`. `stripPptxExtension` keeps its existing signature and export. Consumed by Task 7's export route.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `tests/lib/docx-export.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import JSZip from "jszip";
import { buildInstructorGuideDocx, stripPptxExtension } from "@/lib/docx-export";
import type { JobRow, SlideRow } from "@/lib/db";
import { TRAINER_GUIDELINES_DOS, TRAINER_GUIDELINES_DONTS, MATERIAL_REQUIRED_ITEMS } from "@/lib/static-guide-content";

function fakeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    filename: "My Deck.pptx",
    status: "done",
    totalSlides: 1,
    completedSlides: 1,
    error: null,
    workshopTitle: null,
    duration: null,
    learningObjectives: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeSlide(overrides: Partial<SlideRow> = {}): SlideRow {
  return {
    id: "slide-1",
    jobId: "job-1",
    index: 0,
    imagePath: path.join(process.cwd(), "tests/fixtures/sample-slide.png"),
    extractedText: "Welcome",
    slideIntent: null,
    recommendedSections: null,
    confidence: null,
    sections: null,
    status: "done",
    error: null,
    ...overrides,
  };
}

async function documentXmlOf(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml")!.async("string");
}

describe("stripPptxExtension", () => {
  it("strips a .pptx extension", () => {
    expect(stripPptxExtension("My Deck.pptx")).toBe("My Deck");
  });

  it("strips a .PPTX extension case-insensitively", () => {
    expect(stripPptxExtension("My Deck.PPTX")).toBe("My Deck");
  });

  it("leaves a filename without a .pptx extension unchanged", () => {
    expect(stripPptxExtension("My Deck")).toBe("My Deck");
  });
});

describe("buildInstructorGuideDocx front matter", () => {
  it("falls back to the filename as title when workshopTitle is null", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob({ workshopTitle: null }), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("My Deck");
  });

  it("uses workshopTitle over the filename when present", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob({ workshopTitle: "AI in Practice" }), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("AI in Practice");
    expect(xml).not.toContain("My Deck");
  });

  it("renders a blank duration when none was found", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob({ duration: null }), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Duration:");
  });

  it("renders the exact duration text when present", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob({ duration: "2 hours" }), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Duration:");
    expect(xml).toContain("2 hours");
  });

  it("renders one bullet per learning objective", async () => {
    const buffer = await buildInstructorGuideDocx(
      fakeJob({
        learningObjectives: JSON.stringify(["Understand prompting", "Apply the five-block structure"]),
      }),
      [fakeSlide()]
    );
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Understand prompting");
    expect(xml).toContain("Apply the five-block structure");
  });

  it("renders an empty Learning Objectives section when none were generated", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob({ learningObjectives: null }), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Learning Objectives");
  });

  it("renders the static Trainer Guidelines table content", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Trainer Guidelines");
    expect(xml).toContain(TRAINER_GUIDELINES_DOS[0]);
    expect(xml).toContain(TRAINER_GUIDELINES_DONTS[0]);
  });

  it("renders the static Material Required section", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Material Required for the Workshop");
    expect(xml).toContain(MATERIAL_REQUIRED_ITEMS[0]);
  });

  it("renders a Session Guide heading before the per-slide content", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    const sessionGuideIndex = xml.indexOf("Session Guide");
    const slideHeadingIndex = xml.indexOf("Slide 1");
    expect(sessionGuideIndex).toBeGreaterThan(-1);
    expect(slideHeadingIndex).toBeGreaterThan(sessionGuideIndex);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/docx-export.test.ts`
Expected: FAIL — `buildInstructorGuideDocx` is currently called with `(slides, title)`, not `(job, slides)`; TypeScript/runtime mismatch, and none of the new front-matter content exists yet.

- [ ] **Step 3: Rewrite docx-export.ts**

Replace the full contents of `src/lib/docx-export.ts`:

```ts
import fs from "node:fs/promises";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";
import type { JobRow, SlideRow } from "@/lib/db";
import { SECTION_TITLES } from "@/types/guide";
import type { GuideSection } from "@/types/guide";
import { parseMarkdownLite } from "@/lib/markdown-lite";
import type { MarkdownBlock } from "@/lib/markdown-lite";
import {
  TRAINER_GUIDELINES_DOS,
  TRAINER_GUIDELINES_DONTS,
  MATERIAL_REQUIRED_ITEMS,
  TRAINING_AIDS_ITEMS,
  TRAINING_VIDEO_ITEMS,
} from "@/lib/static-guide-content";

const MAX_IMAGE_WIDTH = 600;

export function stripPptxExtension(filename: string): string {
  return filename.replace(/\.pptx$/i, "");
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function scaledDimensions(width: number, height: number): { width: number; height: number } {
  if (width <= MAX_IMAGE_WIDTH) return { width, height };
  const scale = MAX_IMAGE_WIDTH / width;
  return { width: MAX_IMAGE_WIDTH, height: Math.round(height * scale) };
}

function markdownBlocksToParagraphs(blocks: MarkdownBlock[]): Paragraph[] {
  return blocks.map(
    (block) =>
      new Paragraph({
        bullet: block.type === "bullet" ? { level: 0 } : undefined,
        children: block.runs.map((run) => new TextRun({ text: run.text, bold: run.bold })),
      })
  );
}

function bulletParagraphs(items: string[]): Paragraph[] {
  return items.map(
    (item) =>
      new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun(item)],
      })
  );
}

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

  return paragraphs;
}

async function slideToParagraphs(slide: SlideRow): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(`Slide ${slide.index + 1}`)],
    }),
  ];

  const imageBuffer = await fs.readFile(slide.imagePath);
  const { width: rawWidth, height: rawHeight } = readPngDimensions(imageBuffer);
  const { width, height } = scaledDimensions(rawWidth, rawHeight);

  paragraphs.push(
    new Paragraph({
      children: [
        new ImageRun({
          data: imageBuffer,
          transformation: { width, height },
          type: "png",
        }),
      ],
    })
  );

  if (slide.status === "failed") {
    paragraphs.push(
      new Paragraph({ children: [new TextRun("This slide failed to generate.")] })
    );
  }

  const sections: GuideSection[] = slide.sections ? JSON.parse(slide.sections) : [];
  for (const section of sections) {
    paragraphs.push(...sectionToParagraphs(section));
  }

  return paragraphs;
}

function twoColumnCell(text: string, bold = false): TableCell {
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  });
}

function trainerGuidelinesTable(): Table {
  const rowCount = Math.max(TRAINER_GUIDELINES_DOS.length, TRAINER_GUIDELINES_DONTS.length);

  const headerRow = new TableRow({
    children: [twoColumnCell("Do's", true), twoColumnCell("Don'ts", true)],
  });

  const bodyRows = Array.from(
    { length: rowCount },
    (_, i) =>
      new TableRow({
        children: [
          twoColumnCell(TRAINER_GUIDELINES_DOS[i] ?? ""),
          twoColumnCell(TRAINER_GUIDELINES_DONTS[i] ?? ""),
        ],
      })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  });
}

function heading(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}

function frontMatter(job: JobRow): (Paragraph | Table)[] {
  const title = job.workshopTitle ?? stripPptxExtension(job.filename);
  const learningObjectives: string[] = job.learningObjectives ? JSON.parse(job.learningObjectives) : [];

  return [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }),
    new Paragraph({ children: [new TextRun(`Duration: ${job.duration ?? ""}`)] }),
    heading("Learning Objectives"),
    ...bulletParagraphs(learningObjectives),
    heading("Trainer Guidelines"),
    trainerGuidelinesTable(),
    heading("Material Required for the Workshop"),
    ...bulletParagraphs(MATERIAL_REQUIRED_ITEMS),
    heading("Training Aids for the Workshop"),
    ...bulletParagraphs(TRAINING_AIDS_ITEMS),
    heading("Training videos and important links"),
    ...bulletParagraphs(TRAINING_VIDEO_ITEMS),
    heading("Session Guide"),
  ];
}

export async function buildInstructorGuideDocx(job: JobRow, slides: SlideRow[]): Promise<Buffer> {
  const slideParagraphs = await Promise.all(slides.map(slideToParagraphs));

  const doc = new Document({
    title: job.workshopTitle ?? stripPptxExtension(job.filename),
    sections: [
      {
        children: [...frontMatter(job), ...slideParagraphs.flat()],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/lib/docx-export.test.ts`
Expected: PASS (all `stripPptxExtension` and `buildInstructorGuideDocx front matter` tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/docx-export.ts tests/lib/docx-export.test.ts
git commit -m "Restructure docx-export with Workshop Title/Duration/Learning Objectives/static front matter"
```

---

### Task 7: Wire the new docx-export signature into the export route

**Files:**
- Modify: `src/app/api/jobs/[id]/export/route.ts`
- Test: `tests/api/export.test.ts`

**Interfaces:**
- Consumes: `buildInstructorGuideDocx(job: JobRow, slides: SlideRow[])` from Task 6.
- Produces: no new exports — this is the final integration point exposed to the browser via `GET /api/jobs/[id]/export`.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/export.test.ts`, inside the existing `describe("GET /api/jobs/:id/export", ...)` block, right after the last existing `it(...)`:

```ts

  it("uses the job's generated workshopTitle, duration, and learning objectives when present", async () => {
    const job = await db.job.create({ filename: "My Deck.pptx", status: "done" });
    await db.job.update({
      where: { id: job.id },
      data: {
        workshopTitle: "AI in Practice",
        duration: "4:00 PM to 6:30 PM",
        learningObjectives: JSON.stringify(["Understand prompting fundamentals"]),
      },
    });
    await db.slide.create({
      jobId: job.id,
      index: 0,
      imagePath: path.join(process.cwd(), "tests/fixtures/sample-slide.png"),
      extractedText: "Welcome",
      status: "done",
    });

    const req = new NextRequest(`http://localhost/api/jobs/${job.id}/export`);
    const res = await GET(req, { params: { id: job.id } });

    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain("AI in Practice");
    expect(documentXml).toContain("4:00 PM to 6:30 PM");
    expect(documentXml).toContain("Understand prompting fundamentals");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/api/export.test.ts`
Expected: FAIL — the route currently calls `buildInstructorGuideDocx(slides, stripPptxExtension(job.filename))`, which no longer matches the Task 6 signature, so the response won't contain the job's generated title/duration/objectives (TypeScript will also flag the call-site signature mismatch).

- [ ] **Step 3: Update the export route**

Replace the full contents of `src/app/api/jobs/[id]/export/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildInstructorGuideDocx } from "@/lib/docx-export";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const job = await db.job.findUnique({ where: { id: params.id } });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const slides = await db.slide.findMany({
    where: { jobId: params.id },
    orderBy: { index: "asc" },
  });

  if (slides.length === 0) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const buffer = await buildInstructorGuideDocx(job, slides);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="instructor-guide-${params.id}.docx"`,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run tests/api/export.test.ts`
Expected: PASS (all tests in `describe("GET /api/jobs/:id/export", ...)`, including the pre-existing filename-fallback test and the new workshopTitle/duration/objectives test)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test`
Expected: all test files pass

Run: `npx tsc --noEmit`
Expected: no output, exit code 0

- [ ] **Step 6: Commit**

```bash
git add src/app/api/jobs/[id]/export/route.ts tests/api/export.test.ts
git commit -m "Pass the Job row through to buildInstructorGuideDocx in the export route"
```
