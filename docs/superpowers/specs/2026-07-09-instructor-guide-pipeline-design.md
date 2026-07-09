# AI Instructor Guide Generation Pipeline — Implementation Design

Date: 2026-07-09
Status: Approved for planning

## Objective

Build a Next.js application that accepts a PowerPoint (PPTX) upload and generates a per-slide
instructor guide using a two-call LLM pipeline (slide analysis, then targeted content generation),
so instructor guides contain only the sections that are genuinely useful for each slide instead of
a fixed template applied to every slide.

This document covers the *application* design (stack, data flow, storage, job processing, UI). The
LLM prompts and JSON schemas for Call 1 (Slide Analyzer) and Call 2 (Instructor Guide Generator) are
already fully specified by the user and are treated as fixed inputs to this design — see
"LLM Call Contracts" below for how the app integrates with them.

## Scope

In scope:
- PPTX upload
- Slide → image conversion (LibreOffice headless) and slide → text extraction (PPTX XML parsing)
- Two-call Gemini pipeline per slide (analysis, then generation)
- Background job processing with progress polling
- In-app viewer rendering each slide image + its generated sections
- PDF export of the full guide
- SQLite-backed persistence of jobs/slides/results
- No authentication (single-user/internal tool)

Out of scope (explicitly deferred):
- User accounts / multi-tenant access control
- Cloud object storage / multi-instance deployment
- Editing or regenerating individual sections after generation
- Support for file formats other than `.pptx`

## Stack

- **Framework:** Next.js (App Router, TypeScript)
- **Database:** SQLite via Prisma
- **File storage:** Local filesystem (`storage/<jobId>/...`)
- **LLM provider:** Google Gemini (`@google/generative-ai`), using `responseSchema` structured output
  exactly as defined in the user's spec (Call 1 and Call 2 schemas/prompts, unchanged)
- **Slide rendering:** LibreOffice headless (`soffice`) for PPTX → PDF → PNG per slide
- **Text extraction:** Direct PPTX XML parsing (`jszip` + XML parsing of `ppt/slides/slideN.xml`)
- **Job processing:** In-process background worker (async queue with concurrency limit), no Redis
- **Deployment target:** Single self-hosted server/container (LibreOffice must be installed in the
  runtime image — this rules out platforms without persistent processes, e.g. standard Vercel
  serverless functions)

## Architecture / Data Flow

```
POST /api/upload (PPTX file)
   │
   ▼
Save file to storage/<jobId>/original.pptx
Create Job row (status=pending, totalSlides=null)
Enqueue job in in-process worker queue
Return { jobId } to client immediately
   │
   ▼
Worker picks up job (status=processing):
   1. Convert PPTX → PDF → PNG per slide (LibreOffice)
        storage/<jobId>/slides/{n}.png
   2. Parse PPTX XML → extracted text per slide index
   3. Create Slide rows (one per slide), set Job.totalSlides
   4. For each slide, with bounded concurrency (e.g. 3 at a time):
        a. Call 1 (Gemini): { imageBase64, extractedText } → { slideIntent, recommendedSections, confidence }
        b. Call 2 (Gemini): { imageBase64, extractedText, slideIntent, recommendedSections } → { sections[] }
        c. Save result to Slide row, set Slide.status=done
        d. Increment Job.completedSlides
        e. On failure at this slide: set Slide.status=failed, Slide.error=<message>, continue others
   5. When all slides are done or failed: set Job.status=done
        (Job.status=failed only if conversion/extraction itself fails before any slide processing starts)
   │
   ▼
Client polls GET /api/jobs/:id every ~2s for { status, totalSlides, completedSlides }
   │
   ▼
On status=done, client navigates to /guide/:jobId
   Viewer renders each slide: image + rendered sections (only sections present in Slide.sections)
   │
   ▼
User may click "Export PDF" → GET /api/jobs/:id/export
   Server renders the same slide+guide layout and produces a PDF, streamed back for download
```

## Data Model (Prisma / SQLite)

```prisma
model Job {
  id              String   @id @default(cuid())
  filename        String
  status          String   // pending | processing | done | failed
  totalSlides     Int?
  completedSlides Int      @default(0)
  error           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  slides          Slide[]
}

model Slide {
  id                 String   @id @default(cuid())
  jobId              String
  job                Job      @relation(fields: [jobId], references: [id])
  index              Int
  imagePath          String
  extractedText      String
  slideIntent        String?
  recommendedSections String? // JSON array of section keys
  confidence         Float?
  sections           String? // JSON array of { type, title, content?, items? } per Call 2 schema
  status             String  // pending | processing | done | failed
  error              String?

  @@unique([jobId, index])
}
```

## Components

1. **Upload route** — `POST /api/upload`. Accepts multipart PPTX upload, validates extension/size,
   writes to `storage/<jobId>/original.pptx`, creates the `Job` row, enqueues processing, returns
   `{ jobId }`.

2. **Conversion module** (`lib/conversion.ts`) — shells out to `soffice --headless --convert-to pdf`
   then converts the resulting PDF to one PNG per page (e.g. via `pdftoppm` or a PDF rendering
   library). Writes files to `storage/<jobId>/slides/<n>.png` and returns the slide count.

3. **Extraction module** (`lib/extraction.ts`) — unzips the PPTX with `jszip`, reads
   `ppt/slides/slideN.xml` for each slide, parses `<a:t>` text runs in document order, and returns an
   array of extracted text per slide index. Slide indices from conversion and extraction are matched
   by position (slide N in the PPTX maps to page N in the rendered PDF).

4. **Gemini client module** (`lib/gemini.ts`) — exposes `analyzeSlide(imageBase64, text)` and
   `generateGuide(imageBase64, text, slideIntent, recommendedSections)`. Uses the exact prompts and
   `responseSchema` objects from the user's spec, unmodified. Both functions validate the parsed
   JSON response against a Zod schema mirroring the Gemini schema before returning, and throw on
   malformed output (caught by the worker as a per-slide failure).

5. **Worker module** (`lib/worker.ts`) — an in-process async queue. On job creation it's pushed onto
   an internal list; a loop with a concurrency cap (e.g. `p-limit`) processes queued jobs, and within
   a job, processes slides with their own concurrency cap. Runs in the same Node process as the
   Next.js server (requires a persistent-process deployment, e.g. `next start` in a long-running
   container — not compatible with ephemeral serverless functions).

6. **Progress API** — `GET /api/jobs/:id` returns `{ status, totalSlides, completedSlides, error }`.

7. **Viewer page** — `/guide/[jobId]`. Server-fetches all `Slide` rows for the job, renders each as
   a card: slide image on one side, generated sections on the other. Renders only sections present
   in `Slide.sections` — no placeholder headings for sections that weren't recommended.

8. **PDF export** — `GET /api/jobs/:id/export`. Uses a headless browser (Playwright) to render the
   viewer page's print layout and stream back a generated PDF file.

## LLM Call Contracts

Call 1 and Call 2 prompts and `responseSchema` are taken verbatim from the user-provided spec
(slideIntent enum, recommendedSections enum, section generation rules, FAQ/interview question
rules). The application layer's responsibility is limited to:
- Supplying `{ imageBase64, extractedText }` as input to Call 1
- Passing Call 1's output (`slideIntent`, `recommendedSections`) plus the same slide inputs to Call 2
- Persisting Call 2's `sections[]` array as-is
- Never generating instructor content itself, and never overriding recommendedSections

## Error Handling

- **Per-slide failure** (Gemini error, malformed JSON, timeout): mark that `Slide.status = failed`
  with an error message; other slides continue processing; job still reaches `status=done` once all
  slides have resolved (done or failed). Viewer shows a "regenerate this slide" action on failed
  slides (calls a `/api/slides/:id/retry` route that re-runs Call 1 + Call 2 for just that slide).
- **Conversion/extraction failure** (corrupt PPTX, LibreOffice crash): the whole `Job.status = failed`
  with an error message; no slides are created.
- **Upload validation failure**: rejected synchronously at `/api/upload` with a 4xx response (wrong
  file extension, file too large, empty file).

## Testing Strategy

- **Unit — extraction:** given a small fixture PPTX, assert extracted text matches expected per-slide
  strings.
- **Unit — conversion:** given a small fixture PPTX, assert the expected number of PNG files are
  produced (smoke test; skip in environments without LibreOffice installed, e.g. flag as
  integration-only).
- **Unit — Gemini client:** mock the Gemini SDK response; verify `analyzeSlide` and `generateGuide`
  correctly construct requests and validate/parse responses, and throw on schema-invalid output.
- **Integration:** run a small (3-5 slide) fixture deck through the full pipeline end-to-end
  (upload → worker → viewer data), asserting each slide gets exactly one `slideIntent` and only its
  `recommendedSections` appear in the final `sections[]`.

## Open Follow-ups (not blocking this spec)

- Retry/backoff policy for transient Gemini API errors (rate limits) — initial version can rely on
  the per-slide failure + manual retry action; automatic retry can be added later.
- Cleanup policy for old jobs/files on disk (no expiry in v1).
