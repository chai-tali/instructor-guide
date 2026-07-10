# Instructor Guide Export: PDF → DOCX

## Problem

The instructor guide is currently exported as a PDF by launching headless Chromium (Playwright), navigating it to the live `/guide/[jobId]` page, and printing that page to PDF. The user wants the export to be a Word document (`.docx`) instead, fully replacing the PDF export — not offered alongside it.

## Goals

- `GET /api/jobs/[id]/export` returns a `.docx` file instead of a PDF, with the same route path (only the response format and file extension change).
- The `.docx` mirrors what the PDF/web guide shows per slide: the slide image, a "failed to generate" note where applicable, and every guide section (prose content or Q&A items), with the section's Markdown formatting (bold, bullet lists) rendered as real Word formatting — not raw `**bold**` syntax.
- Drop the Playwright/Chromium dependency entirely, since nothing else in the app uses it. This also removes a known deployment prerequisite (installing Chromium's system libraries in production images) that a prior review flagged as unresolved.
- Generation is fully in-process (no external binary, no live HTTP round-trip to `APP_BASE_URL`) — the route fetches slide data directly from Postgres, the same way the guide page already does.

## Non-Goals

- No support for the full CommonMark spec — only the Markdown subset the Gemini prompts in `src/lib/gemini.ts` actually produce: paragraphs, `**bold**` inline spans, and `-`/`*` bullet lines. Nested lists, links, headings-within-content, tables, etc. are out of scope.
- No PDF export option retained — this fully replaces PDF, per explicit decision.
- No Google Docs / Drive integration.

## Architecture

### New files

**`src/lib/markdown-lite.ts`**

Parses a Markdown string into a small structured form that `docx-export.ts` can render directly, without pulling in a full Markdown/AST library:

```ts
export interface MarkdownRun {
  text: string;
  bold: boolean;
}

export interface MarkdownBlock {
  type: "paragraph" | "bullet";
  runs: MarkdownRun[];
}

export function parseMarkdownLite(text: string): MarkdownBlock[];
```

Rules:
- Input is split into blocks on blank lines.
- A block whose every line starts with `-` or `*` (after trimming) becomes one `"bullet"` block per line (leading marker stripped).
- Any other block becomes one `"paragraph"` block per line within it (so multi-line paragraphs without a blank line between them still produce separate paragraphs, matching how `ReactMarkdown` already treats them on the web).
- Within each line, `**bold**` spans are split into `MarkdownRun`s with `bold: true`; everything else is `bold: false`. Unmatched/unterminated `**` is treated as literal text (no crash, no dropped content).
- Empty input returns `[]`.

**`src/lib/docx-export.ts`**

```ts
export async function buildInstructorGuideDocx(slides: SlideRow[]): Promise<Buffer>;
```

For each slide (already ordered by `index` by the caller):
1. Heading: `Slide N` (N = `index + 1`).
2. Image: read the PNG at `slide.imagePath` from disk, parse its width/height from the PNG `IHDR` chunk (small local helper, no new dependency), scale to a fixed max display width (e.g. 600px) preserving aspect ratio, embed via `docx`'s `ImageRun`.
3. If `slide.status === "failed"`: a paragraph reading "This slide failed to generate." (no retry control — this is a static document).
4. For each section in `JSON.parse(slide.sections ?? "[]")`:
   - Subheading: `section.title || SECTION_TITLES[section.type] || section.type`.
   - If `section.content`: render via `parseMarkdownLite` → one `docx.Paragraph` per block (bullet blocks get Word's built-in bullet list formatting; bold runs become bold `TextRun`s).
   - If `section.items`: for each `{ question, answer }`, a paragraph with the question bolded (skipped if `question === "bullet"`, matching `SlideCard.tsx`'s existing convention) followed by the answer rendered via `parseMarkdownLite`.

Returns the built `Document` packed to a `Buffer` via `docx`'s `Packer.toBuffer`.

### Modified files

**`src/types/guide.ts`** — add:
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
(moved here from `SlideCard.tsx`, which currently defines this map locally — `docx-export.ts` needs the same map, so it becomes shared state instead of a second copy that could drift.)

**`src/components/SlideCard.tsx`** — import `SECTION_TITLES` from `@/types/guide` instead of defining it locally. No behavior change.

**`src/app/api/jobs/[id]/export/route.ts`** — full rewrite:
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
(The 404-on-empty-result is a small consistency improvement — every other route in the app already 404s on an unknown ID; the old PDF route had no such check because it just screenshotted whatever the guide page happened to render.)

**`src/app/guide/[jobId]/page.tsx`** — link text "Export PDF" → "Export Guide (.docx)"; `href` unchanged (`/api/jobs/${params.jobId}/export`).

**`package.json`** — remove `playwright` (confirmed unused anywhere else via `grep -rn "playwright" src tests`), add `docx`.

## Error Handling

- Unknown/empty job → `404` (new behavior, see above).
- A slide's `sections` field is `null`/unparseable → treated as `[]`, matching the guide page's existing `slide.sections ? JSON.parse(...) : []` pattern.
- A slide image file missing from disk → this would throw inside `fs.readFile`; no special handling added, since the same failure mode already exists (unhandled) in the `/api/slides/[id]/image` route today — out of scope to harden here.

## Testing

- `tests/lib/markdown-lite.test.ts` — unit tests for `parseMarkdownLite`: plain paragraph, multi-paragraph (blank-line-separated), bold spans, bullet list, mixed bold+bullets, empty string, unterminated `**`.
- `tests/api/export.test.ts` — route-level test: seed a job with one `"done"` slide (with sections) via `db`, `GET` the route, assert `200`, `Content-Type` is the docx MIME type, `Content-Disposition` includes `.docx`, and the response body starts with the zip magic bytes `PK` (docx is a zip container) — not deep XML/document-content assertions, per YAGNI. Also assert `404` for an unknown job id.
- `docx-export.ts` gets indirect coverage through the route test; its only real branching logic (Markdown formatting) is covered directly by the `markdown-lite` tests.
