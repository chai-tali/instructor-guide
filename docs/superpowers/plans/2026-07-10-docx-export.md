# DOCX Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Playwright/Chromium PDF export of the instructor guide with an in-process `.docx` export, dropping the Playwright dependency entirely.

**Architecture:** `GET /api/jobs/[id]/export` keeps its path but is rewritten to fetch slide rows directly from Postgres (the same query the guide page already runs) and build a Word document in-process via the `docx` npm package. A small hand-written Markdown-subset parser (`src/lib/markdown-lite.ts`) converts the bold/bullet/paragraph Markdown that Gemini actually produces into a structured form `src/lib/docx-export.ts` renders as real Word formatting. `SECTION_TITLES` moves from `SlideCard.tsx` into `src/types/guide.ts` so both the web view and the docx builder share one source of truth.

**Tech Stack:** `docx` ^9.7.1 (Word document generation), Node's built-in `Buffer`/`fs.readFile` (no new image-handling dependency — PNG width/height are read directly from the file's `IHDR` chunk).

## Global Constraints

- Only the Markdown subset Gemini's prompts actually produce is supported: paragraphs, `**bold**` inline spans, `-`/`*` bullet lines. No nested lists, links, tables.
- The `.docx` export fully replaces the PDF export — no PDF option remains, `playwright` is removed from `package.json`.
- `GET /api/jobs/[id]/export` returns `404` for an unknown/empty job (new behavior vs. the old PDF route, for consistency with every other route in this app).
- Content-Type: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`; filename: `instructor-guide-<id>.docx`.
- Generation is fully in-process — no external binary, no live HTTP round-trip to `APP_BASE_URL`.

---

### Task 1: Markdown-lite parser

**Files:**
- Create: `src/lib/markdown-lite.ts`
- Test: `tests/lib/markdown-lite.test.ts`

**Interfaces:**
- Produces: `export interface MarkdownRun { text: string; bold: boolean }`, `export interface MarkdownBlock { type: "paragraph" | "bullet"; runs: MarkdownRun[] }`, `export function parseMarkdownLite(text: string): MarkdownBlock[]` — consumed by Task 3's `docx-export.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/markdown-lite.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseMarkdownLite } from "@/lib/markdown-lite";

describe("parseMarkdownLite", () => {
  it("parses a plain paragraph", () => {
    expect(parseMarkdownLite("Hello world")).toEqual([
      { type: "paragraph", runs: [{ text: "Hello world", bold: false }] },
    ]);
  });

  it("splits blank-line-separated blocks into separate paragraphs", () => {
    expect(parseMarkdownLite("First paragraph.\n\nSecond paragraph.")).toEqual([
      { type: "paragraph", runs: [{ text: "First paragraph.", bold: false }] },
      { type: "paragraph", runs: [{ text: "Second paragraph.", bold: false }] },
    ]);
  });

  it("splits multi-line text without a blank line into separate paragraphs", () => {
    expect(parseMarkdownLite("Line one.\nLine two.")).toEqual([
      { type: "paragraph", runs: [{ text: "Line one.", bold: false }] },
      { type: "paragraph", runs: [{ text: "Line two.", bold: false }] },
    ]);
  });

  it("parses bold spans within a paragraph", () => {
    expect(parseMarkdownLite("This is **bold** text.")).toEqual([
      {
        type: "paragraph",
        runs: [
          { text: "This is ", bold: false },
          { text: "bold", bold: true },
          { text: " text.", bold: false },
        ],
      },
    ]);
  });

  it("parses a bullet list", () => {
    expect(parseMarkdownLite("- First item\n- Second item")).toEqual([
      { type: "bullet", runs: [{ text: "First item", bold: false }] },
      { type: "bullet", runs: [{ text: "Second item", bold: false }] },
    ]);
  });

  it("parses bullets with bold spans, using * as the marker", () => {
    expect(parseMarkdownLite("* **Important**: read this\n* Another point")).toEqual([
      {
        type: "bullet",
        runs: [
          { text: "Important", bold: true },
          { text: ": read this", bold: false },
        ],
      },
      { type: "bullet", runs: [{ text: "Another point", bold: false }] },
    ]);
  });

  it("returns an empty array for empty or whitespace-only input", () => {
    expect(parseMarkdownLite("")).toEqual([]);
    expect(parseMarkdownLite("   \n\n  ")).toEqual([]);
  });

  it("treats unterminated bold markers as literal text", () => {
    expect(parseMarkdownLite("This has **unterminated bold")).toEqual([
      {
        type: "paragraph",
        runs: [{ text: "This has **unterminated bold", bold: false }],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/markdown-lite.test.ts`
Expected: FAIL with "Cannot find module '@/lib/markdown-lite'" (or similar — the module doesn't exist yet).

- [ ] **Step 3: Implement the parser**

Create `src/lib/markdown-lite.ts`:

```ts
export interface MarkdownRun {
  text: string;
  bold: boolean;
}

export interface MarkdownBlock {
  type: "paragraph" | "bullet";
  runs: MarkdownRun[];
}

const BULLET_PREFIX = /^[-*]\s+/;
const BOLD_SPAN = /\*\*(.+?)\*\*/g;

function isBulletLine(line: string): boolean {
  return BULLET_PREFIX.test(line);
}

function parseInlineRuns(line: string): MarkdownRun[] {
  const runs: MarkdownRun[] = [];
  const regex = new RegExp(BOLD_SPAN);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: line.slice(lastIndex, match.index), bold: false });
    }
    runs.push({ text: match[1], bold: true });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < line.length) {
    runs.push({ text: line.slice(lastIndex), bold: false });
  }

  return runs;
}

export function parseMarkdownLite(text: string): MarkdownBlock[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const blocks: MarkdownBlock[] = [];
  const rawBlocks = trimmed.split(/\n\s*\n/);

  for (const rawBlock of rawBlocks) {
    const lines = rawBlock
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) continue;

    const isBulletBlock = lines.every(isBulletLine);

    if (isBulletBlock) {
      for (const line of lines) {
        const content = line.replace(BULLET_PREFIX, "");
        blocks.push({ type: "bullet", runs: parseInlineRuns(content) });
      }
    } else {
      for (const line of lines) {
        blocks.push({ type: "paragraph", runs: parseInlineRuns(line) });
      }
    }
  }

  return blocks;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/markdown-lite.test.ts`
Expected: PASS, 8/8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/markdown-lite.ts tests/lib/markdown-lite.test.ts
git commit -m "Add markdown-lite parser for DOCX export"
```

---

### Task 2: Share SECTION_TITLES between the web view and the DOCX builder

**Files:**
- Modify: `src/types/guide.ts`
- Modify: `src/components/SlideCard.tsx`

**Interfaces:**
- Produces: `export const SECTION_TITLES: Record<string, string>` from `@/types/guide` — consumed by `SlideCard.tsx` (this task) and `src/lib/docx-export.ts` (Task 3).

- [ ] **Step 1: Add `SECTION_TITLES` to `src/types/guide.ts`**

Append to the end of `src/types/guide.ts` (after the existing `InstructorGuide` interface):

```ts

export const SECTION_TITLES: Record<string, string> = {
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
```

- [ ] **Step 2: Remove the local copy from `SlideCard.tsx` and import the shared one**

In `src/components/SlideCard.tsx`, change:

```ts
import ReactMarkdown from "react-markdown";
import type { GuideSection } from "@/types/guide";
import { RetrySlideButton } from "@/components/RetrySlideButton";

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
```

to:

```ts
import ReactMarkdown from "react-markdown";
import type { GuideSection } from "@/types/guide";
import { SECTION_TITLES } from "@/types/guide";
import { RetrySlideButton } from "@/components/RetrySlideButton";
```

(the rest of `SlideCard.tsx` — the component body using `SECTION_TITLES[section.type]` — is unchanged, since the imported binding has the same name and shape).

- [ ] **Step 3: Typecheck and run the existing test suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all suites pass (this task doesn't change behavior, so all pre-existing tests — including any that render `SlideCard` indirectly — must still pass).

- [ ] **Step 4: Commit**

```bash
git add src/types/guide.ts src/components/SlideCard.tsx
git commit -m "Share SECTION_TITLES between SlideCard and DOCX export"
```

---

### Task 3: DOCX document builder

**Files:**
- Create: `src/lib/docx-export.ts`
- Modify: `package.json` (add `docx` dependency)

**Interfaces:**
- Consumes: `SlideRow` from `@/lib/db` (Task 3's predecessor — already exists), `GuideSection`/`GuideSectionItem`/`SECTION_TITLES` from `@/types/guide` (Task 2), `parseMarkdownLite`/`MarkdownBlock` from `@/lib/markdown-lite` (Task 1).
- Produces: `export async function buildInstructorGuideDocx(slides: SlideRow[]): Promise<Buffer>` — consumed by Task 4's rewritten export route.

- [ ] **Step 1: Add the `docx` dependency**

Run: `npm install docx@^9.7.1`

- [ ] **Step 2: Write `src/lib/docx-export.ts`**

```ts
import fs from "node:fs/promises";
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } from "docx";
import type { SlideRow } from "@/lib/db";
import { SECTION_TITLES } from "@/types/guide";
import type { GuideSection } from "@/types/guide";
import { parseMarkdownLite } from "@/lib/markdown-lite";
import type { MarkdownBlock } from "@/lib/markdown-lite";

const MAX_IMAGE_WIDTH = 600;

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

export async function buildInstructorGuideDocx(slides: SlideRow[]): Promise<Buffer> {
  const slideParagraphs = await Promise.all(slides.map(slideToParagraphs));

  const doc = new Document({
    sections: [
      {
        children: slideParagraphs.flat(),
      },
    ],
  });

  return Packer.toBuffer(doc);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (Task 4 hasn't rewired the route yet, so nothing calls `buildInstructorGuideDocx` yet — this only confirms `docx-export.ts` itself compiles cleanly).

- [ ] **Step 4: Commit**

```bash
git add src/lib/docx-export.ts package.json package-lock.json
git commit -m "Add DOCX document builder"
```

---

### Task 4: Rewrite the export route, update the guide page link, remove Playwright

**Files:**
- Modify: `src/app/api/jobs/[id]/export/route.ts`
- Modify: `src/app/guide/[jobId]/page.tsx`
- Modify: `package.json` (remove `playwright`)
- Test: `tests/api/export.test.ts`

**Interfaces:**
- Consumes: `buildInstructorGuideDocx` from `@/lib/docx-export` (Task 3), `db.slide.findMany` from `@/lib/db` (already exists).

- [ ] **Step 1: Write the failing route test**

Create `tests/api/export.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { GET } from "@/app/api/jobs/[id]/export/route";
import { NextRequest } from "next/server";
import path from "node:path";

describe("GET /api/jobs/:id/export", () => {
  beforeEach(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
  });

  afterAll(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
  });

  it("returns 404 for an unknown job", async () => {
    const req = new NextRequest("http://localhost/api/jobs/unknown/export");
    const res = await GET(req, { params: { id: "unknown" } });
    expect(res.status).toBe(404);
  });

  it("returns a downloadable docx for a job with slides", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "done" });
    await db.slide.create({
      jobId: job.id,
      index: 0,
      imagePath: path.join(process.cwd(), "tests/fixtures/sample-slide.png"),
      extractedText: "Welcome",
      status: "done",
      sections: JSON.stringify([
        { type: "trainerPointer", title: "Trainer Pointer", content: "Say hello to the class." },
      ]),
    });

    const req = new NextRequest(`http://localhost/api/jobs/${job.id}/export`);
    const res = await GET(req, { params: { id: job.id } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(res.headers.get("Content-Disposition")).toContain(`instructor-guide-${job.id}.docx`);

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
```

This test needs a real (small) PNG fixture on disk. Create `tests/fixtures/sample-slide.png` by generating a minimal 2x2 PNG:

```bash
node -e "
const fs = require('fs');
const path = require('path');
// Smallest valid 2x2 red PNG, base64-encoded.
const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';
fs.mkdirSync(path.join(process.cwd(), 'tests/fixtures'), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), 'tests/fixtures/sample-slide.png'), Buffer.from(base64, 'base64'));
console.log('wrote tests/fixtures/sample-slide.png');
"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/api/export.test.ts`
Expected: FAIL — the route still imports `playwright`/`chromium` and tries to launch a browser and hit `APP_BASE_URL`, so the 404 test will fail (old route doesn't check for empty slides) and the docx test will fail (response is a PDF, not docx, and likely errors without a running server at `APP_BASE_URL`).

- [ ] **Step 3: Rewrite the export route**

Replace the full contents of `src/app/api/jobs/[id]/export/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildInstructorGuideDocx } from "@/lib/docx-export";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slides = await db.slide.findMany({
    where: { jobId: params.id },
    orderBy: { index: "asc" },
  });

  if (slides.length === 0) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const buffer = await buildInstructorGuideDocx(slides);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="instructor-guide-${params.id}.docx"`,
    },
  });
}
```

- [ ] **Step 4: Update the guide page's export link text**

In `src/app/guide/[jobId]/page.tsx`, change:

```tsx
      <a className="no-print" href={`/api/jobs/${params.jobId}/export`}>
        Export PDF
      </a>
```

to:

```tsx
      <a className="no-print" href={`/api/jobs/${params.jobId}/export`}>
        Export Guide (.docx)
      </a>
```

- [ ] **Step 5: Remove the `playwright` dependency**

Run: `npm uninstall playwright`

- [ ] **Step 6: Run the export test to verify it passes**

Run: `npx vitest run tests/api/export.test.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all suites pass, including the new `tests/api/export.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/jobs/[id]/export/route.ts "src/app/guide/[jobId]/page.tsx" package.json package-lock.json tests/api/export.test.ts tests/fixtures/sample-slide.png
git commit -m "Replace PDF export with DOCX export, remove Playwright"
```
