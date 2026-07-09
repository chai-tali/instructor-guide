# Instructor Guide Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js app that accepts a PPTX upload and produces a per-slide instructor guide via a two-call Gemini pipeline (analyze, then generate only the recommended sections), viewable in-app and exportable as a PDF.

**Architecture:** Upload saves the PPTX and creates a `Job` row; an in-process background worker converts slides to PNGs (LibreOffice), extracts slide text (PPTX XML parsing), then runs Call 1 (`analyzeSlide`) and Call 2 (`generateGuide`) against Gemini for each slide with bounded concurrency, persisting results to SQLite via Prisma. The client polls job progress, then renders a viewer page reading straight from the DB; a Playwright-based route renders that same page to PDF.

**Tech Stack:** Next.js 14 (App Router, TypeScript), Prisma + SQLite, `@google/generative-ai`, `zod`, `p-limit`, `jszip` + `fast-xml-parser`, LibreOffice (`soffice`) + `poppler-utils` (`pdftoppm`), `playwright`, `vitest`.

## Global Constraints

- No authentication — this is a single-user/internal tool (per approved spec).
- Deployment target is a single persistent server/container (not serverless) — LibreOffice and Poppler must be installed in the runtime image, and the in-process worker requires a long-running Node process.
- Only `.pptx` files are accepted; reject other extensions at upload with a 400.
- Max upload size: 50MB, enforced at `/api/upload`.
- Storage is local filesystem under `storage/<jobId>/...` (path configurable via `STORAGE_DIR` env var, defaulting to `<project root>/storage`).
- LLM provider is Google Gemini via `@google/generative-ai`, using the exact prompts and `responseSchema` shapes from the approved spec (`docs/superpowers/specs/2026-07-09-instructor-guide-pipeline-design.md`) — application code must not alter slide-intent enum values, recommended-section keys, or section-generation rules.
- Job queue is in-process (no Redis); slide-level concurrency capped at 3 via `p-limit`.
- Per-slide failures must not fail the whole job; only conversion/extraction failures fail the whole job.
- Test database is a separate SQLite file (`prisma/test.db`), selected via `DATABASE_URL` env var set through the `cross-env` wrapper in the `test`/`pretest` npm scripts — never point tests at the dev database.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx` (placeholder, replaced in Task 11)

**Interfaces:**
- Produces: a runnable Next.js dev server (`npm run dev`) and a working Vitest runner (`npm test`) that later tasks build on.

- [ ] **Step 1: Initialize the Next.js project**

```bash
cd /home/chaitali/Documents/instructor-guide
npx create-next-app@14 . --typescript --app --eslint --no-tailwind --no-src-dir=false --import-alias "@/*" --use-npm
```

When prompted, confirm defaults. This creates `package.json`, `tsconfig.json`, `next.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx`, and ESLint config.

- [ ] **Step 2: Install runtime and dev dependencies**

```bash
npm install @google/generative-ai zod p-limit jszip fast-xml-parser playwright @prisma/client
npm install -D prisma vitest cross-env pptxgenjs @types/node
```

- [ ] **Step 3: Add npm scripts to `package.json`**

Edit the `"scripts"` block to:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "prisma:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "pretest": "cross-env DATABASE_URL=file:./prisma/test.db prisma db push --skip-generate",
    "test": "cross-env DATABASE_URL=file:./prisma/test.db vitest run",
    "test:watch": "cross-env DATABASE_URL=file:./prisma/test.db vitest"
  }
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 5: Append storage/db entries to `.gitignore`**

```bash
cat >> .gitignore << 'EOF'

# Instructor Guide app
storage/
prisma/*.db
prisma/*.db-journal
.env
EOF
```

- [ ] **Step 6: Create `.env.example`**

```bash
GEMINI_API_KEY=your-gemini-api-key-here
DATABASE_URL=file:./prisma/dev.db
STORAGE_DIR=./storage
APP_BASE_URL=http://localhost:3000
```

- [ ] **Step 7: Verify the dev server starts**

```bash
npm run dev &
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
kill %1
```

Expected: prints `200` (or `404` if the placeholder page was removed — either confirms the server is serving requests).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js project with test/build tooling"
```

---

## Task 2: Database Schema and Client

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/db.ts`
- Create: `src/lib/storage.ts`

**Interfaces:**
- Produces: `prisma` (singleton `PrismaClient` instance) from `src/lib/db.ts`; `STORAGE_DIR` constant from `src/lib/storage.ts`; `Job` and `Slide` Prisma models used by every later task.

- [ ] **Step 1: Initialize Prisma**

```bash
npx prisma init --datasource-provider sqlite
```

This creates `prisma/schema.prisma` and `.env` (already gitignored from Task 1).

- [ ] **Step 2: Write the schema**

Replace the contents of `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Job {
  id              String   @id @default(cuid())
  filename        String
  status          String   @default("pending") // pending | processing | done | failed
  totalSlides     Int?
  completedSlides Int      @default(0)
  error           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  slides          Slide[]
}

model Slide {
  id                  String  @id @default(cuid())
  jobId               String
  job                 Job     @relation(fields: [jobId], references: [id])
  index               Int
  imagePath           String
  extractedText       String
  slideIntent         String?
  recommendedSections String? // JSON array of section keys
  confidence          Float?
  sections            String? // JSON array of GuideSection
  status              String  @default("pending") // pending | processing | done | failed
  error               String?

  @@unique([jobId, index])
}
```

- [ ] **Step 3: Create the dev database and generate the client**

```bash
echo 'DATABASE_URL="file:./prisma/dev.db"' > .env
npx prisma migrate dev --name init
```

Expected output includes `Your database is now in sync with your schema.` and generates the Prisma client.

- [ ] **Step 4: Create the test database schema**

```bash
npm run pretest
```

Expected: `The SQLite database "test.db" ... is now in sync with your Prisma schema.`

- [ ] **Step 5: Create `src/lib/db.ts`**

```ts
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
```

- [ ] **Step 6: Create `src/lib/storage.ts`**

```ts
import path from "node:path";

export const STORAGE_DIR = process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage");
```

- [ ] **Step 7: Verify with a throwaway script**

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.job.create({ data: { filename: 'test.pptx', status: 'pending' } })
  .then((job) => { console.log('created', job.id); return prisma.job.delete({ where: { id: job.id } }); })
  .then(() => console.log('deleted ok'))
  .finally(() => prisma.\$disconnect());
"
```

Expected: prints `created <id>` then `deleted ok`.

- [ ] **Step 8: Commit**

```bash
git add prisma src/lib/db.ts src/lib/storage.ts .gitignore
git commit -m "Add Prisma schema for Job/Slide and DB client"
```

---

## Task 3: Shared Types and Response Schemas

**Files:**
- Create: `src/types/guide.ts`
- Create: `src/lib/schemas.ts`
- Test: `tests/lib/schemas.test.ts`

**Interfaces:**
- Produces: `SLIDE_INTENTS`, `SECTION_KEYS`, `SlideIntent`, `SectionKey`, `SlideAnalysis`, `GuideSection`, `GuideSectionItem`, `InstructorGuide` (from `src/types/guide.ts`); `slideAnalysisSchema`, `instructorGuideSchema` (Zod schemas, from `src/lib/schemas.ts`).
- Consumes: nothing (foundation types for Tasks 6, 7, 12).

- [ ] **Step 1: Write `src/types/guide.ts`**

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
```

- [ ] **Step 2: Write the failing test for the Zod schemas**

Create `tests/lib/schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { slideAnalysisSchema, instructorGuideSchema } from "@/lib/schemas";

describe("slideAnalysisSchema", () => {
  it("accepts a valid analysis payload", () => {
    const result = slideAnalysisSchema.parse({
      slideIntent: "ARCHITECTURE",
      recommendedSections: ["trainerPointer", "whyItMatters"],
      confidence: 0.97,
    });
    expect(result.slideIntent).toBe("ARCHITECTURE");
  });

  it("rejects an invalid slideIntent", () => {
    expect(() =>
      slideAnalysisSchema.parse({
        slideIntent: "NOT_A_REAL_INTENT",
        recommendedSections: [],
        confidence: 0.5,
      })
    ).toThrow();
  });

  it("rejects confidence outside 0..1", () => {
    expect(() =>
      slideAnalysisSchema.parse({
        slideIntent: "SUMMARY",
        recommendedSections: [],
        confidence: 1.5,
      })
    ).toThrow();
  });
});

describe("instructorGuideSchema", () => {
  it("accepts sections with content or items", () => {
    const result = instructorGuideSchema.parse({
      sections: [
        { type: "trainerPointer", title: "Trainer Pointer", content: "Say hi." },
        {
          type: "faq",
          title: "FAQ",
          items: [{ question: "Why?", answer: "Because." }],
        },
      ],
    });
    expect(result.sections).toHaveLength(2);
  });

  it("rejects a section missing required fields", () => {
    expect(() =>
      instructorGuideSchema.parse({ sections: [{ title: "Missing type" }] })
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test -- tests/lib/schemas.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/schemas'`.

- [ ] **Step 4: Write `src/lib/schemas.ts`**

```ts
import { z } from "zod";
import { SLIDE_INTENTS, SECTION_KEYS } from "@/types/guide";

export const slideAnalysisSchema = z.object({
  slideIntent: z.enum(SLIDE_INTENTS),
  recommendedSections: z.array(z.enum(SECTION_KEYS)),
  confidence: z.number().min(0).max(1),
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
});

export const instructorGuideSchema = z.object({
  sections: z.array(guideSectionSchema),
});
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test -- tests/lib/schemas.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/types/guide.ts src/lib/schemas.ts tests/lib/schemas.test.ts
git commit -m "Add shared guide types and Zod response schemas"
```

---

## Task 4: Fixture Deck and Text Extraction

**Files:**
- Create: `scripts/generate-fixture.mjs`
- Create: `tests/fixtures/sample.pptx` (generated binary, committed)
- Create: `src/lib/extraction.ts`
- Test: `tests/lib/extraction.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `extractSlideTexts(pptxPath: string): Promise<string[]>` from `src/lib/extraction.ts`, used by Task 7 (worker) and Task 14 (integration test). Also produces the checked-in 3-slide fixture deck used by Tasks 5, 7, and 14.

- [ ] **Step 1: Write the fixture generator script**

Create `scripts/generate-fixture.mjs`:

```js
import pptxgen from "pptxgenjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pres = new pptxgen();

const slide1 = pres.addSlide();
slide1.addText("Welcome to the Course", { x: 1, y: 1, fontSize: 32 });

const slide2 = pres.addSlide();
slide2.addText("Agenda", { x: 1, y: 0.5, fontSize: 28 });
slide2.addText("1. Introduction\n2. Core Concepts\n3. Wrap Up", {
  x: 1,
  y: 1.5,
  fontSize: 18,
});

const slide3 = pres.addSlide();
slide3.addText("Thank You", { x: 1, y: 1, fontSize: 32 });

await pres.writeFile({
  fileName: path.join(__dirname, "../tests/fixtures/sample.pptx"),
});
console.log("Fixture written to tests/fixtures/sample.pptx");
```

- [ ] **Step 2: Generate the fixture**

```bash
mkdir -p tests/fixtures
node scripts/generate-fixture.mjs
```

Expected: `Fixture written to tests/fixtures/sample.pptx`, and the file exists.

- [ ] **Step 3: Write the failing test**

Create `tests/lib/extraction.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { extractSlideTexts } from "@/lib/extraction";

describe("extractSlideTexts", () => {
  it("extracts text per slide in order from the fixture deck", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/sample.pptx");
    const texts = await extractSlideTexts(fixturePath);

    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain("Welcome to the Course");
    expect(texts[1]).toContain("Agenda");
    expect(texts[1]).toContain("Introduction");
    expect(texts[2]).toContain("Thank You");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
npm test -- tests/lib/extraction.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/extraction'`.

- [ ] **Step 5: Write `src/lib/extraction.ts`**

```ts
import fs from "node:fs/promises";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, textNodeName: "#text" });

function collectText(node: unknown, out: string[]): void {
  if (node == null) return;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out);
    return;
  }
  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "a:t") {
        collectText(value, out);
      } else if (typeof value === "object") {
        collectText(value, out);
      }
    }
  }
}

export async function extractSlideTexts(pptxPath: string): Promise<string[]> {
  const buffer = await fs.readFile(pptxPath);
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)![1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)![1], 10);
      return na - nb;
    });

  const texts: string[] = [];
  for (const filename of slideFiles) {
    const xml = await zip.files[filename].async("string");
    const parsed = parser.parse(xml);
    const out: string[] = [];
    collectText(parsed, out);
    texts.push(out.join("\n"));
  }
  return texts;
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm test -- tests/lib/extraction.test.ts
```

Expected: PASS, 1 test.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-fixture.mjs tests/fixtures/sample.pptx src/lib/extraction.ts tests/lib/extraction.test.ts
git commit -m "Add fixture deck and PPTX text extraction"
```

---

## Task 5: Slide Image Conversion

**Files:**
- Create: `src/lib/conversion.ts`
- Test: `tests/lib/conversion.test.ts`

**Interfaces:**
- Consumes: `tests/fixtures/sample.pptx` (from Task 4).
- Produces: `convertPptxToSlideImages(pptxPath: string, outputDir: string): Promise<number>` from `src/lib/conversion.ts`, used by Task 7 (worker) and Task 14 (integration test). Output files are named `<n>.png` (1-indexed) inside `outputDir`.

**Environment prerequisite:** `soffice` (LibreOffice) and `pdftoppm` (Poppler) must be on `PATH`. Install on Debian/Ubuntu with `sudo apt-get install -y libreoffice poppler-utils`. The test below skips itself with a warning if these are not installed, so CI/dev environments without them still pass the suite — but this task's implementation must be reviewed for correctness even if the test skips locally.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/conversion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { convertPptxToSlideImages } from "@/lib/conversion";

const execFileAsync = promisify(execFile);

async function hasSoffice(): Promise<boolean> {
  try {
    await execFileAsync("soffice", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

describe("convertPptxToSlideImages", () => {
  it("converts each slide of the fixture deck to a numbered PNG", async () => {
    if (!(await hasSoffice())) {
      console.warn("Skipping: soffice not installed in this environment");
      return;
    }
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ig-conv-"));
    const fixturePath = path.join(process.cwd(), "tests/fixtures/sample.pptx");

    const count = await convertPptxToSlideImages(fixturePath, tmpDir);

    expect(count).toBe(3);
    for (let i = 1; i <= count; i++) {
      const stat = await fs.stat(path.join(tmpDir, `${i}.png`));
      expect(stat.isFile()).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/lib/conversion.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/conversion'`.

- [ ] **Step 3: Write `src/lib/conversion.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export async function convertPptxToSlideImages(
  pptxPath: string,
  outputDir: string
): Promise<number> {
  await fs.mkdir(outputDir, { recursive: true });

  await execFileAsync("soffice", [
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    outputDir,
    pptxPath,
  ]);

  const pptxBasename = path.basename(pptxPath, path.extname(pptxPath));
  const pdfPath = path.join(outputDir, `${pptxBasename}.pdf`);

  await execFileAsync("pdftoppm", [
    "-png",
    "-r",
    "150",
    pdfPath,
    path.join(outputDir, "slide"),
  ]);

  const files = (await fs.readdir(outputDir)).filter(
    (f) => f.startsWith("slide") && f.endsWith(".png")
  );
  files.sort((a, b) => {
    const na = parseInt(a.match(/(\d+)/)?.[1] ?? "0", 10);
    const nb = parseInt(b.match(/(\d+)/)?.[1] ?? "0", 10);
    return na - nb;
  });

  await Promise.all(
    files.map((file, i) =>
      fs.rename(path.join(outputDir, file), path.join(outputDir, `${i + 1}.png`))
    )
  );

  await fs.rm(pdfPath, { force: true });

  return files.length;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/lib/conversion.test.ts
```

Expected: PASS if `soffice`/`pdftoppm` are installed (1 test); otherwise prints the skip warning and passes with 0 assertions run.

- [ ] **Step 5: Commit**

```bash
git add src/lib/conversion.ts tests/lib/conversion.test.ts
git commit -m "Add PPTX to per-slide PNG conversion via LibreOffice/Poppler"
```

---

## Task 6: Gemini Client

**Files:**
- Create: `src/lib/gemini.ts`
- Test: `tests/lib/gemini.test.ts`

**Interfaces:**
- Consumes: `SlideAnalysis`, `InstructorGuide`, `SlideIntent`, `SectionKey`, `SLIDE_INTENTS`, `SECTION_KEYS` (Task 3 types); `slideAnalysisSchema`, `instructorGuideSchema` (Task 3 schemas).
- Produces: `analyzeSlide(imageBase64: string, extractedText: string): Promise<SlideAnalysis>` and `generateGuide(imageBase64: string, extractedText: string, slideIntent: SlideIntent, recommendedSections: SectionKey[]): Promise<InstructorGuide>` from `src/lib/gemini.ts`, used by Task 7 (worker).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/gemini.test.ts`:

```ts
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

import { analyzeSlide, generateGuide } from "@/lib/gemini";

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
            recommendedSections: ["trainerPointer", "whyItMatters"],
            confidence: 0.9,
          }),
      },
    });

    const result = await analyzeSlide("base64image", "some slide text");

    expect(result.slideIntent).toBe("CONCEPT");
    expect(result.recommendedSections).toEqual(["trainerPointer", "whyItMatters"]);
    expect(result.confidence).toBe(0.9);
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/lib/gemini.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/gemini'`.

- [ ] **Step 3: Write `src/lib/gemini.ts`**

```ts
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
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

const analyzerResponseSchema = {
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

const generatorResponseSchema = {
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/lib/gemini.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gemini.ts tests/lib/gemini.test.ts
git commit -m "Add Gemini client for slide analysis and guide generation"
```

---

## Task 7: Background Worker

**Files:**
- Create: `src/lib/worker.ts`
- Test: `tests/lib/worker.test.ts`

**Interfaces:**
- Consumes: `convertPptxToSlideImages` (Task 5), `extractSlideTexts` (Task 4), `analyzeSlide`/`generateGuide` (Task 6), `prisma` (Task 2), `STORAGE_DIR` (Task 2).
- Produces: `enqueueJob(jobId: string): void` and `processJob(jobId: string): Promise<void>` and `processSlide(slideId: string, jobId: string): Promise<void>` from `src/lib/worker.ts`, used by Task 8 (upload route) and Task 10 (retry route).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/worker.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

vi.mock("@/lib/conversion", () => ({
  convertPptxToSlideImages: vi.fn(),
}));
vi.mock("@/lib/extraction", () => ({
  extractSlideTexts: vi.fn(),
}));
vi.mock("@/lib/gemini", () => ({
  analyzeSlide: vi.fn(),
  generateGuide: vi.fn(),
}));

import { convertPptxToSlideImages } from "@/lib/conversion";
import { extractSlideTexts } from "@/lib/extraction";
import { analyzeSlide, generateGuide } from "@/lib/gemini";
import { processJob } from "@/lib/worker";
import { prisma } from "@/lib/db";

describe("processJob", () => {
  let tmpDir: string;

  beforeEach(async () => {
    await prisma.slide.deleteMany();
    await prisma.job.deleteMany();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ig-test-"));
    process.env.STORAGE_DIR = tmpDir;
    vi.mocked(convertPptxToSlideImages).mockReset();
    vi.mocked(extractSlideTexts).mockReset();
    vi.mocked(analyzeSlide).mockReset();
    vi.mocked(generateGuide).mockReset();
  });

  afterAll(async () => {
    await prisma.slide.deleteMany();
    await prisma.job.deleteMany();
  });

  it("processes every slide and marks the job done", async () => {
    const job = await prisma.job.create({ data: { filename: "deck.pptx", status: "pending" } });
    const slidesDir = path.join(tmpDir, job.id, "slides");
    await fs.mkdir(slidesDir, { recursive: true });
    await fs.writeFile(path.join(slidesDir, "1.png"), Buffer.from("fake-png"));
    await fs.writeFile(path.join(slidesDir, "2.png"), Buffer.from("fake-png"));

    vi.mocked(convertPptxToSlideImages).mockResolvedValue(2);
    vi.mocked(extractSlideTexts).mockResolvedValue(["Slide one text", "Slide two text"]);
    vi.mocked(analyzeSlide).mockResolvedValue({
      slideIntent: "CONCEPT",
      recommendedSections: ["trainerPointer"],
      confidence: 0.9,
    });
    vi.mocked(generateGuide).mockResolvedValue({
      sections: [{ type: "trainerPointer", title: "Trainer Pointer", content: "Explain it." }],
    });

    await processJob(job.id);

    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe("done");
    expect(updated.completedSlides).toBe(2);

    const slides = await prisma.slide.findMany({
      where: { jobId: job.id },
      orderBy: { index: "asc" },
    });
    expect(slides).toHaveLength(2);
    expect(slides[0].status).toBe("done");
    expect(JSON.parse(slides[0].sections!)).toEqual([
      { type: "trainerPointer", title: "Trainer Pointer", content: "Explain it." },
    ]);
  });

  it("marks only the failing slide as failed and still completes the job", async () => {
    const job = await prisma.job.create({ data: { filename: "deck.pptx", status: "pending" } });
    const slidesDir = path.join(tmpDir, job.id, "slides");
    await fs.mkdir(slidesDir, { recursive: true });
    await fs.writeFile(path.join(slidesDir, "1.png"), Buffer.from("fake-png"));
    await fs.writeFile(path.join(slidesDir, "2.png"), Buffer.from("fake-png"));

    vi.mocked(convertPptxToSlideImages).mockResolvedValue(2);
    vi.mocked(extractSlideTexts).mockResolvedValue(["Slide one", "Slide two"]);
    vi.mocked(analyzeSlide)
      .mockResolvedValueOnce({
        slideIntent: "CONCEPT",
        recommendedSections: ["trainerPointer"],
        confidence: 0.9,
      })
      .mockRejectedValueOnce(new Error("Gemini timeout"));
    vi.mocked(generateGuide).mockResolvedValue({
      sections: [{ type: "trainerPointer", title: "Trainer Pointer", content: "Explain it." }],
    });

    await processJob(job.id);

    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe("done");

    const slides = await prisma.slide.findMany({
      where: { jobId: job.id },
      orderBy: { index: "asc" },
    });
    expect(slides.map((s) => s.status).sort()).toEqual(["done", "failed"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/lib/worker.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/worker'`.

- [ ] **Step 3: Write `src/lib/worker.ts`**

```ts
import pLimit from "p-limit";
import path from "node:path";
import fs from "node:fs/promises";
import { prisma } from "@/lib/db";
import { convertPptxToSlideImages } from "@/lib/conversion";
import { extractSlideTexts } from "@/lib/extraction";
import { analyzeSlide, generateGuide } from "@/lib/gemini";
import { STORAGE_DIR } from "@/lib/storage";
import type { SlideIntent, SectionKey } from "@/types/guide";

const jobQueue: string[] = [];
let processing = false;

export function enqueueJob(jobId: string): void {
  jobQueue.push(jobId);
  void drainQueue();
}

async function drainQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  while (jobQueue.length > 0) {
    const jobId = jobQueue.shift()!;
    await processJob(jobId);
  }
  processing = false;
}

export async function processJob(jobId: string): Promise<void> {
  const jobDir = path.join(STORAGE_DIR, jobId);
  const pptxPath = path.join(jobDir, "original.pptx");
  const slidesDir = path.join(jobDir, "slides");

  try {
    await prisma.job.update({ where: { id: jobId }, data: { status: "processing" } });

    const slideCount = await convertPptxToSlideImages(pptxPath, slidesDir);
    const texts = await extractSlideTexts(pptxPath);

    await prisma.job.update({ where: { id: jobId }, data: { totalSlides: slideCount } });

    const slideRecords = await Promise.all(
      Array.from({ length: slideCount }, (_, index) =>
        prisma.slide.create({
          data: {
            jobId,
            index,
            imagePath: path.join(slidesDir, `${index + 1}.png`),
            extractedText: texts[index] ?? "",
            status: "pending",
          },
        })
      )
    );

    const limit = pLimit(3);
    await Promise.all(
      slideRecords.map((slide) => limit(() => processSlide(slide.id, jobId)))
    );

    await prisma.job.update({ where: { id: jobId }, data: { status: "done" } });
  } catch (err) {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "failed", error: (err as Error).message },
    });
  }
}

export async function processSlide(slideId: string, jobId: string): Promise<void> {
  const slide = await prisma.slide.findUniqueOrThrow({ where: { id: slideId } });

  try {
    await prisma.slide.update({ where: { id: slideId }, data: { status: "processing" } });

    const imageBase64 = (await fs.readFile(slide.imagePath)).toString("base64");
    const analysis = await analyzeSlide(imageBase64, slide.extractedText);
    const guide = await generateGuide(
      imageBase64,
      slide.extractedText,
      analysis.slideIntent as SlideIntent,
      analysis.recommendedSections as SectionKey[]
    );

    await prisma.slide.update({
      where: { id: slideId },
      data: {
        slideIntent: analysis.slideIntent,
        recommendedSections: JSON.stringify(analysis.recommendedSections),
        confidence: analysis.confidence,
        sections: JSON.stringify(guide.sections),
        status: "done",
      },
    });
  } catch (err) {
    await prisma.slide.update({
      where: { id: slideId },
      data: { status: "failed", error: (err as Error).message },
    });
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { completedSlides: { increment: 1 } },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/lib/worker.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/worker.ts tests/lib/worker.test.ts
git commit -m "Add in-process background worker for slide processing"
```

---

## Task 8: Upload API Route

**Files:**
- Create: `src/app/api/upload/route.ts`
- Test: `tests/api/upload.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `STORAGE_DIR` (Task 2), `enqueueJob` (Task 7).
- Produces: `POST` handler at `/api/upload` returning `{ jobId: string }` on success, used by Task 11 (upload UI).

- [ ] **Step 1: Write the failing test**

Create `tests/api/upload.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { NextRequest } from "next/server";

vi.mock("@/lib/worker", () => ({
  enqueueJob: vi.fn(),
}));

import { enqueueJob } from "@/lib/worker";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/upload/route";

describe("POST /api/upload", () => {
  let tmpDir: string;

  beforeEach(async () => {
    await prisma.job.deleteMany();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ig-upload-"));
    process.env.STORAGE_DIR = tmpDir;
    vi.mocked(enqueueJob).mockReset();
  });

  afterAll(async () => {
    await prisma.job.deleteMany();
  });

  it("rejects non-pptx files", async () => {
    const formData = new FormData();
    formData.append("file", new File(["hello"], "notes.txt", { type: "text/plain" }));
    const req = new NextRequest("http://localhost/api/upload", { method: "POST", body: formData });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("creates a job, saves the file, and enqueues processing", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File(["fake pptx bytes"], "deck.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      })
    );
    const req = new NextRequest("http://localhost/api/upload", { method: "POST", body: formData });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.jobId).toBeTruthy();

    const job = await prisma.job.findUniqueOrThrow({ where: { id: body.jobId } });
    expect(job.filename).toBe("deck.pptx");
    expect(job.status).toBe("pending");

    const savedFile = await fs.readFile(path.join(tmpDir, body.jobId, "original.pptx"));
    expect(savedFile.toString()).toBe("fake pptx bytes");

    expect(enqueueJob).toHaveBeenCalledWith(body.jobId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/api/upload.test.ts
```

Expected: FAIL — `Cannot find module '@/app/api/upload/route'`.

- [ ] **Step 3: Write `src/app/api/upload/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/worker";
import { STORAGE_DIR } from "@/lib/storage";

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pptx")) {
    return NextResponse.json({ error: "Only .pptx files are supported" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 50MB limit" }, { status: 400 });
  }

  const job = await prisma.job.create({
    data: { filename: file.name, status: "pending" },
  });

  const jobDir = path.join(STORAGE_DIR, job.id);
  await fs.mkdir(jobDir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(jobDir, "original.pptx"), buffer);

  enqueueJob(job.id);

  return NextResponse.json({ jobId: job.id });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/api/upload.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/upload/route.ts tests/api/upload.test.ts
git commit -m "Add PPTX upload API route"
```

---

## Task 9: Job Status API Route

**Files:**
- Create: `src/app/api/jobs/[id]/route.ts`
- Test: `tests/api/jobs.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2).
- Produces: `GET` handler at `/api/jobs/:id` returning `{ status, totalSlides, completedSlides, error }`, used by Task 11 (`JobProgress` polling component).

- [ ] **Step 1: Write the failing test**

Create `tests/api/jobs.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "@/app/api/jobs/[id]/route";
import { NextRequest } from "next/server";

describe("GET /api/jobs/:id", () => {
  beforeEach(async () => {
    await prisma.slide.deleteMany();
    await prisma.job.deleteMany();
  });

  afterAll(async () => {
    await prisma.slide.deleteMany();
    await prisma.job.deleteMany();
  });

  it("returns 404 for an unknown job", async () => {
    const req = new NextRequest("http://localhost/api/jobs/unknown");
    const res = await GET(req, { params: { id: "unknown" } });
    expect(res.status).toBe(404);
  });

  it("returns job status fields", async () => {
    const job = await prisma.job.create({
      data: { filename: "deck.pptx", status: "processing", totalSlides: 5, completedSlides: 2 },
    });

    const req = new NextRequest(`http://localhost/api/jobs/${job.id}`);
    const res = await GET(req, { params: { id: job.id } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      status: "processing",
      totalSlides: 5,
      completedSlides: 2,
      error: null,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/api/jobs.test.ts
```

Expected: FAIL — `Cannot find module '@/app/api/jobs/[id]/route'`.

- [ ] **Step 3: Write `src/app/api/jobs/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const job = await prisma.job.findUnique({ where: { id: params.id } });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    totalSlides: job.totalSlides,
    completedSlides: job.completedSlides,
    error: job.error,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/api/jobs.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/[id]/route.ts tests/api/jobs.test.ts
git commit -m "Add job status API route"
```

---

## Task 10: Slide Retry API Route

**Files:**
- Create: `src/app/api/slides/[id]/retry/route.ts`
- Test: `tests/api/retry.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `processSlide` (Task 7).
- Produces: `POST` handler at `/api/slides/:id/retry`, used by Task 12 (viewer page's retry action on failed slides).

- [ ] **Step 1: Write the failing test**

Create `tests/api/retry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/worker", () => ({
  processSlide: vi.fn(),
}));

import { processSlide } from "@/lib/worker";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/slides/[id]/retry/route";

describe("POST /api/slides/:id/retry", () => {
  beforeEach(async () => {
    await prisma.slide.deleteMany();
    await prisma.job.deleteMany();
    vi.mocked(processSlide).mockReset();
  });

  afterAll(async () => {
    await prisma.slide.deleteMany();
    await prisma.job.deleteMany();
  });

  it("returns 404 for an unknown slide", async () => {
    const req = new NextRequest("http://localhost/api/slides/unknown/retry", { method: "POST" });
    const res = await POST(req, { params: { id: "unknown" } });
    expect(res.status).toBe(404);
  });

  it("re-processes an existing slide", async () => {
    const job = await prisma.job.create({ data: { filename: "deck.pptx", status: "done" } });
    const slide = await prisma.slide.create({
      data: {
        jobId: job.id,
        index: 0,
        imagePath: "/tmp/1.png",
        extractedText: "text",
        status: "failed",
      },
    });

    const req = new NextRequest(`http://localhost/api/slides/${slide.id}/retry`, { method: "POST" });
    const res = await POST(req, { params: { id: slide.id } });

    expect(res.status).toBe(200);
    expect(processSlide).toHaveBeenCalledWith(slide.id, job.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/api/retry.test.ts
```

Expected: FAIL — `Cannot find module '@/app/api/slides/[id]/retry/route'`.

- [ ] **Step 3: Write `src/app/api/slides/[id]/retry/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { processSlide } from "@/lib/worker";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slide = await prisma.slide.findUnique({ where: { id: params.id } });

  if (!slide) {
    return NextResponse.json({ error: "Slide not found" }, { status: 404 });
  }

  await processSlide(slide.id, slide.jobId);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/api/retry.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/slides/[id]/retry/route.ts tests/api/retry.test.ts
git commit -m "Add slide retry API route"
```

---

## Task 11: Upload UI and Progress Page

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/components/UploadForm.tsx`
- Create: `src/app/jobs/[id]/page.tsx`
- Create: `src/components/JobProgress.tsx`

**Interfaces:**
- Consumes: `POST /api/upload` (Task 8), `GET /api/jobs/:id` (Task 9).
- Produces: the `/` upload page and `/jobs/:id` progress page; navigates to `/guide/:jobId` on completion (Task 12).

This task has no automated tests (per the approved spec's testing strategy, UI is verified manually); each step ends with a manual verification instead of a test run.

- [ ] **Step 1: Create `src/components/UploadForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function UploadForm() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) {
      setError("Please choose a .pptx file");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    setUploading(false);

    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Upload failed");
      return;
    }

    const { jobId } = await res.json();
    router.push(`/jobs/${jobId}`);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="file" name="file" accept=".pptx" />
      <button type="submit" disabled={uploading}>
        {uploading ? "Uploading..." : "Upload"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Replace `src/app/page.tsx`**

```tsx
import { UploadForm } from "@/components/UploadForm";

export default function HomePage() {
  return (
    <main>
      <h1>Instructor Guide Generator</h1>
      <p>Upload a .pptx deck to generate a per-slide instructor guide.</p>
      <UploadForm />
    </main>
  );
}
```

- [ ] **Step 3: Create `src/components/JobProgress.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface JobStatus {
  status: string;
  totalSlides: number | null;
  completedSlides: number;
  error: string | null;
}

export function JobProgress({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const res = await fetch(`/api/jobs/${jobId}`);
      const data: JobStatus = await res.json();
      if (cancelled) return;

      setJob(data);
      if (data.status === "done") {
        router.push(`/guide/${jobId}`);
        return;
      }
      if (data.status !== "failed") {
        setTimeout(poll, 2000);
      }
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [jobId, router]);

  if (!job) return <p>Loading...</p>;
  if (job.status === "failed") return <p role="alert">Processing failed: {job.error}</p>;

  return (
    <p>
      Processing slide {job.completedSlides} of {job.totalSlides ?? "…"}
    </p>
  );
}
```

- [ ] **Step 4: Create `src/app/jobs/[id]/page.tsx`**

```tsx
import { JobProgress } from "@/components/JobProgress";

export default function JobStatusPage({ params }: { params: { id: string } }) {
  return <JobProgress jobId={params.id} />;
}
```

- [ ] **Step 5: Manually verify the upload flow**

```bash
npm run dev &
sleep 5
curl -s -X POST http://localhost:3000/api/upload -F "file=@tests/fixtures/sample.pptx" | tee /tmp/upload-response.json
kill %1
```

Expected: JSON response containing a `jobId`. Then open `http://localhost:3000/jobs/<jobId>` in a browser (or via a follow-up `curl http://localhost:3000/api/jobs/<jobId>`) and confirm the status field progresses from `pending`/`processing` toward `done` (or `failed` if `GEMINI_API_KEY` is not set in this environment — expected without a real key configured).

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/components/UploadForm.tsx src/app/jobs/[id]/page.tsx src/components/JobProgress.tsx
git commit -m "Add upload UI and job progress polling page"
```

---

## Task 12: Viewer Page

**Files:**
- Create: `src/app/api/slides/[id]/image/route.ts`
- Create: `src/app/guide/[jobId]/page.tsx`
- Create: `src/components/SlideCard.tsx`

**Interfaces:**
- Consumes: `prisma` (Task 2), `GuideSection` type (Task 3).
- Produces: the `/guide/:jobId` viewer page and `/api/slides/:id/image` image route, used manually by end users and by Task 13 (PDF export, which renders this same page).

This task has no automated tests (per the approved spec's testing strategy); verify manually via the dev server.

- [ ] **Step 1: Create `src/app/api/slides/[id]/image/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slide = await prisma.slide.findUnique({ where: { id: params.id } });

  if (!slide) {
    return NextResponse.json({ error: "Slide not found" }, { status: 404 });
  }

  const buffer = await fs.readFile(slide.imagePath);
  return new NextResponse(buffer, { headers: { "Content-Type": "image/png" } });
}
```

- [ ] **Step 2: Create `src/components/SlideCard.tsx`**

```tsx
import type { GuideSection } from "@/types/guide";

const SECTION_TITLES: Record<string, string> = {
  trainerPointer: "Trainer Pointer",
  whyItMatters: "Why It Matters",
  mentalModel: "Mental Model",
  bestPractices: "Best Practices",
  commonPitfalls: "Common Pitfalls",
  realWorldImplementation: "Real World Implementation",
  howThisFits: "How This Fits",
  faq: "FAQ",
  interviewQuestions: "Interview Questions",
};

export function SlideCard({
  index,
  imagePath,
  status,
  sections,
}: {
  index: number;
  imagePath: string;
  status: string;
  sections: GuideSection[];
}) {
  return (
    <section>
      <h2>Slide {index + 1}</h2>
      <img src={imagePath} alt={`Slide ${index + 1}`} width={480} />
      {status === "failed" && <p role="alert">This slide failed to generate.</p>}
      {sections.map((section) => (
        <div key={section.type}>
          <h3>{section.title || SECTION_TITLES[section.type] || section.type}</h3>
          {section.content && <p>{section.content}</p>}
          {section.items && (
            <ul>
              {section.items.map((item, i) => (
                <li key={i}>
                  {item.question !== "bullet" && <strong>{item.question}: </strong>}
                  {item.answer}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 3: Create `src/app/guide/[jobId]/page.tsx`**

```tsx
import { prisma } from "@/lib/db";
import { SlideCard } from "@/components/SlideCard";
import type { GuideSection } from "@/types/guide";

export default async function GuidePage({ params }: { params: { jobId: string } }) {
  const slides = await prisma.slide.findMany({
    where: { jobId: params.jobId },
    orderBy: { index: "asc" },
  });

  return (
    <main>
      <h1>Instructor Guide</h1>
      {slides.map((slide) => (
        <SlideCard
          key={slide.id}
          index={slide.index}
          imagePath={`/api/slides/${slide.id}/image`}
          status={slide.status}
          sections={slide.sections ? (JSON.parse(slide.sections) as GuideSection[]) : []}
        />
      ))}
    </main>
  );
}
```

- [ ] **Step 4: Manually verify the viewer renders**

```bash
npm run dev &
sleep 5
curl -s -X POST http://localhost:3000/api/upload -F "file=@tests/fixtures/sample.pptx" | tee /tmp/upload-response.json
JOB_ID=$(node -e "console.log(require('/tmp/upload-response.json').jobId)")
sleep 15
curl -s http://localhost:3000/api/jobs/$JOB_ID
curl -s http://localhost:3000/guide/$JOB_ID | grep -o "<h2>Slide [0-9]*</h2>"
kill %1
```

Expected: the job status call shows progress, and the guide page HTML contains an `<h2>Slide N</h2>` for each slide once processing completes (requires a valid `GEMINI_API_KEY` in `.env` for real generation; without one, expect a `failed` job status, which is also acceptable confirmation that the error path surfaces correctly).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/slides/[id]/image/route.ts src/app/guide/[jobId]/page.tsx src/components/SlideCard.tsx
git commit -m "Add instructor guide viewer page"
```

---

## Task 13: PDF Export

**Files:**
- Create: `src/app/api/jobs/[id]/export/route.ts`

**Interfaces:**
- Consumes: the `/guide/:jobId` page (Task 12) via HTTP, rendered by Playwright.
- Produces: `GET /api/jobs/:id/export` returning a `application/pdf` response.

This task has no automated tests (per the approved spec's testing strategy — PDF rendering is a thin wrapper verified manually); verify manually via the dev server.

- [ ] **Step 1: Install Playwright's browser binary**

```bash
npx playwright install chromium --with-deps
```

Expected: downloads the Chromium binary needed for headless rendering.

- [ ] **Step 2: Create `src/app/api/jobs/[id]/export/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    await page.goto(`${baseUrl}/guide/${params.id}`, { waitUntil: "networkidle" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="instructor-guide-${params.id}.pdf"`,
      },
    });
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 3: Manually verify export produces a PDF**

```bash
npm run dev &
sleep 5
JOB_ID=$(node -e "console.log(require('/tmp/upload-response.json').jobId)")
curl -s http://localhost:3000/api/jobs/$JOB_ID/export -o /tmp/instructor-guide.pdf
file /tmp/instructor-guide.pdf
kill %1
```

Expected: `file` reports `/tmp/instructor-guide.pdf: PDF document`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/jobs/[id]/export/route.ts
git commit -m "Add PDF export route for instructor guides"
```

---

## Task 14: Full Pipeline Integration Test

**Files:**
- Test: `tests/integration/pipeline.test.ts`

**Interfaces:**
- Consumes: `processJob` (Task 7), `prisma` (Task 2), `tests/fixtures/sample.pptx` (Task 4). Mocks `analyzeSlide`/`generateGuide` (Task 6) to avoid real Gemini API calls; exercises real `convertPptxToSlideImages` (Task 5) and `extractSlideTexts` (Task 4).
- Produces: end-to-end confidence that upload-shaped input flows through to completed `Slide` rows with only their recommended sections populated.

- [ ] **Step 1: Write the test**

Create `tests/integration/pipeline.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const execFileAsync = promisify(execFile);

vi.mock("@/lib/gemini", () => ({
  analyzeSlide: vi.fn().mockImplementation(async (_img: string, text: string) => ({
    slideIntent: text.includes("Welcome")
      ? "WELCOME"
      : text.includes("Agenda")
        ? "AGENDA"
        : "THANK_YOU",
    recommendedSections:
      text.includes("Welcome") || text.includes("Agenda") ? ["trainerPointer"] : [],
    confidence: 0.95,
  })),
  generateGuide: vi
    .fn()
    .mockImplementation(async (_img: string, _text: string, _intent: string, recommendedSections: string[]) => ({
      sections: recommendedSections.map((type) => ({
        type,
        title: type,
        content: "Generated content",
      })),
    })),
}));

import { processJob } from "@/lib/worker";
import { prisma } from "@/lib/db";

async function hasSoffice(): Promise<boolean> {
  try {
    await execFileAsync("soffice", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

describe("full pipeline", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ig-pipeline-"));
    process.env.STORAGE_DIR = tmpDir;
  });

  afterAll(async () => {
    await prisma.slide.deleteMany();
    await prisma.job.deleteMany();
  });

  it("takes a fixture deck from upload through completed slides", async () => {
    if (!(await hasSoffice())) {
      console.warn("Skipping: soffice not installed in this environment");
      return;
    }

    const job = await prisma.job.create({ data: { filename: "sample.pptx", status: "pending" } });
    const jobDir = path.join(tmpDir, job.id);
    await fs.mkdir(jobDir, { recursive: true });
    await fs.copyFile(
      path.join(process.cwd(), "tests/fixtures/sample.pptx"),
      path.join(jobDir, "original.pptx")
    );

    await processJob(job.id);

    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe("done");
    expect(updated.totalSlides).toBe(3);

    const slides = await prisma.slide.findMany({
      where: { jobId: job.id },
      orderBy: { index: "asc" },
    });
    expect(slides).toHaveLength(3);
    expect(slides[0].slideIntent).toBe("WELCOME");
    expect(JSON.parse(slides[0].sections!)).toEqual([
      { type: "trainerPointer", title: "trainerPointer", content: "Generated content" },
    ]);
    expect(slides[2].slideIntent).toBe("THANK_YOU");
    expect(JSON.parse(slides[2].sections!)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all test files pass, including `tests/integration/pipeline.test.ts` (or its single test prints the soffice-skip warning and passes with 0 assertions if LibreOffice isn't installed in this environment).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/pipeline.test.ts
git commit -m "Add end-to-end pipeline integration test"
```

---

## Post-Plan Verification

- [ ] Run `npm test` and confirm every suite passes.
- [ ] Run `npm run build` and confirm the production build succeeds.
- [ ] With a real `GEMINI_API_KEY` set in `.env`, manually upload `tests/fixtures/sample.pptx` through the browser at `http://localhost:3000`, confirm the progress page redirects to `/guide/:jobId` once done, and confirm the "WELCOME" and "AGENDA" slides show a Trainer Pointer section while "THANK YOU" shows none. Then hit `/api/jobs/:id/export` and confirm a readable PDF downloads.
