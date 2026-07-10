# Replace Prisma/SQLite with Raw Postgres (`pg`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Prisma entirely (ORM + SQLite datasource) and replace it with a Postgres database accessed via the `pg` (node-postgres) driver, keeping the app's job/slide read-write behavior identical.

**Architecture:** A single `Pool` in `src/lib/db.ts` backs a hand-written `db.job.*` / `db.slide.*` object whose method shapes (`create`, `update`, `findUnique`, `findUniqueOrThrow`, `findMany`, `deleteMany`) mirror the subset of the Prisma Client API this codebase actually used, so every call site only needs `prisma.` renamed to `db.` — no call-site logic changes. Schema is a plain `CREATE TABLE` SQL file applied by a small Node script (`scripts/migrate.mjs`), replacing `prisma migrate dev` / `prisma db push`. Local/test Postgres runs via Docker Compose since no native `postgres` binary is installed on this machine.

**Tech Stack:** `pg` (node-postgres) ^8.22, `@types/pg`, Docker Compose (postgres:16-alpine), Node's built-in `crypto.randomUUID()` for IDs (replaces Prisma's `cuid()`).

## Global Constraints

- Every `db.*` call site must keep its exact existing call shape (`{ where: { id }, data: {...} }` etc.) — only the imported binding name (`prisma` → `db`) changes. No behavior changes to worker.ts, API routes, or the guide page.
- Column names stay camelCase and quoted (`"totalSlides"`, `"jobId"`, etc.) to match the existing Prisma-generated schema and the TS field names already used throughout the codebase (`SlideRow`/`JobRow` shapes must match current `prisma.job`/`prisma.slide` return shapes exactly, including `Job.completedSlides` increment semantics).
- `DATABASE_URL` becomes a Postgres connection string (`postgresql://...`); SQLite (`file:...`) support is fully removed.
- Test isolation: tests must keep working against a real Postgres database the same way they worked against `test.db` — one shared DB per test run, `fileParallelism: false` stays in `vitest.config.ts` (still needed: suites still race blanket `deleteMany()` calls against shared tables, this is DB-engine-independent).
- No native `postgres`/`psql` binary is installed locally; Docker is available (Docker 28.0.1) — local/test Postgres must run via `docker compose`.

---

### Task 1: Local Postgres via Docker Compose

**Files:**
- Create: `docker-compose.yml`
- Create: `scripts/init-test-db.sql`

**Interfaces:**
- Produces: a reachable Postgres server on `localhost:5432`, user `postgres` / password `postgres`, with two databases: `instructor_guide` (dev) and `instructor_guide_test` (test), which Task 2's migration script and Task 4's `.env` files depend on.

- [ ] **Step 1: Write the Docker Compose file**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: instructor_guide
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/init-test-db.sql:/docker-entrypoint-initdb.d/init-test-db.sql

volumes:
  pgdata:
```

- [ ] **Step 2: Write the test-database init script**

`docker-entrypoint-initdb.d` scripts only run once, on first container init against `POSTGRES_DB`, so this creates the second database the test suite needs:

```sql
CREATE DATABASE instructor_guide_test;
```

- [ ] **Step 3: Start the container and verify both databases exist**

Run: `docker compose up -d`
Then: `docker compose exec postgres psql -U postgres -l`
Expected: output lists both `instructor_guide` and `instructor_guide_test` databases.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml scripts/init-test-db.sql
git commit -m "Add Docker Compose Postgres service for local dev/test"
```

---

### Task 2: Schema SQL + migration script + `pg` dependency

**Files:**
- Create: `src/lib/schema.sql`
- Create: `scripts/migrate.mjs`
- Modify: `package.json` (dependencies/devDependencies + scripts)

**Interfaces:**
- Consumes: Postgres server from Task 1 (`localhost:5432`, `postgres`/`postgres`).
- Produces: `"Job"` and `"Slide"` tables (schema below) that Task 3's `db.ts` queries against; `node scripts/migrate.mjs` as the migration entrypoint later wired into `package.json`'s `db:migrate` and `pretest` scripts in Task 4.

- [ ] **Step 1: Write the schema SQL**

This mirrors the existing Prisma-generated SQLite schema (`prisma/migrations/20260709122839_init/migration.sql`) field-for-field, translated to Postgres types:

```sql
CREATE TABLE IF NOT EXISTS "Job" (
    "id" TEXT PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalSlides" INTEGER,
    "completedSlides" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
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
    "confidence" REAL,
    "sections" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    UNIQUE ("jobId", "index")
);
```

- [ ] **Step 2: Add the `pg` runtime dependency and `@types/pg` dev dependency**

Run: `npm install pg@^8.22.0`
Run: `npm install --save-dev @types/pg@^8.11.0`

- [ ] **Step 3: Remove the Prisma dependencies**

Nothing imports `@prisma/client` until Task 3 rewrites `db.ts`, so it's safe to uninstall now even though `prisma/schema.prisma` still exists on disk (Task 3 deletes it).

Run: `npm uninstall @prisma/client prisma`

- [ ] **Step 4: Write the migration script**

```js
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(__dirname, "../src/lib/schema.sql"), "utf-8");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(sql);
await pool.end();
console.log("Migration applied.");
```

- [ ] **Step 5: Replace the Prisma scripts in `package.json`**

Remove `"prisma:generate": "prisma generate"` and `"db:migrate": "prisma migrate dev"`. Replace the `db:migrate`, `pretest`, `test`, and `test:watch` scripts:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "db:migrate": "node scripts/migrate.mjs",
  "pretest": "cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test node scripts/migrate.mjs",
  "test": "cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest run",
  "test:watch": "cross-env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test vitest"
}
```

- [ ] **Step 6: Run the migration against both databases and verify the tables exist**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide node scripts/migrate.mjs`
Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide_test node scripts/migrate.mjs`
Then: `docker compose exec postgres psql -U postgres -d instructor_guide_test -c '\dt'`
Expected: lists `"Job"` and `"Slide"` tables.

- [ ] **Step 7: Commit**

```bash
git add src/lib/schema.sql scripts/migrate.mjs package.json package-lock.json
git commit -m "Add Postgres schema, migration script, and pg dependency"
```

---

### Task 3: Rewrite `src/lib/db.ts` and delete Prisma files

**Files:**
- Modify: `src/lib/db.ts` (full rewrite)
- Delete: `prisma/schema.prisma`, `prisma/migrations/`, `prisma/dev.db`, `prisma/test.db`, `prisma.config.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` env var (Postgres connection string), tables from Task 2.
- Produces: `export const pool: Pool` and `export const db` with:
  - `db.job.create(data: { filename: string; status?: string; totalSlides?: number | null; completedSlides?: number }): Promise<JobRow>`
  - `db.job.update(args: { where: { id: string }; data: Partial<{ status: string; totalSlides: number | null; completedSlides: number | { increment: number }; error: string | null }> }): Promise<JobRow>`
  - `db.job.findUnique(args: { where: { id: string } }): Promise<JobRow | null>`
  - `db.job.findUniqueOrThrow(args: { where: { id: string } }): Promise<JobRow>`
  - `db.job.deleteMany(): Promise<void>`
  - `db.slide.create(data: { jobId: string; index: number; imagePath: string; extractedText: string; slideIntent?: string | null; recommendedSections?: string | null; confidence?: number | null; sections?: string | null; status?: string; error?: string | null }): Promise<SlideRow>`
  - `db.slide.update(args: { where: { id: string }; data: Partial<{ slideIntent: string; recommendedSections: string; confidence: number; sections: string; status: string; error: string }> }): Promise<SlideRow>`
  - `db.slide.findUnique(args: { where: { id: string } }): Promise<SlideRow | null>`
  - `db.slide.findUniqueOrThrow(args: { where: { id: string } }): Promise<SlideRow>`
  - `db.slide.findMany(args: { where: { jobId: string }; orderBy?: { index: "asc" | "desc" } }): Promise<SlideRow[]>`
  - `db.slide.deleteMany(): Promise<void>`
  These exact shapes are what Task 4's call-site rename depends on.

- [ ] **Step 1: Write the new `src/lib/db.ts`**

```ts
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

export interface SlideRow {
  id: string;
  jobId: string;
  index: number;
  imagePath: string;
  extractedText: string;
  slideIntent: string | null;
  recommendedSections: string | null;
  confidence: number | null;
  sections: string | null;
  status: string;
  error: string | null;
}

type Increment = { increment: number };

function isIncrement(value: unknown): value is Increment {
  return typeof value === "object" && value !== null && "increment" in value;
}

function buildSetClause(
  data: Record<string, unknown>,
  startIndex: number
): { clause: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  let i = startIndex;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (isIncrement(value)) {
      parts.push(`"${key}" = "${key}" + $${i}`);
      values.push(value.increment);
    } else {
      parts.push(`"${key}" = $${i}`);
      values.push(value);
    }
    i++;
  }
  return { clause: parts.join(", "), values };
}

export const db = {
  job: {
    async create(data: {
      filename: string;
      status?: string;
      totalSlides?: number | null;
      completedSlides?: number;
    }): Promise<JobRow> {
      const id = randomUUID();
      const result = await pool.query<JobRow>(
        `INSERT INTO "Job" (id, filename, status, "totalSlides", "completedSlides")
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, data.filename, data.status ?? "pending", data.totalSlides ?? null, data.completedSlides ?? 0]
      );
      return result.rows[0];
    },

    async update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<JobRow> {
      const { clause, values } = buildSetClause(args.data, 1);
      const result = await pool.query<JobRow>(
        `UPDATE "Job" SET ${clause}, "updatedAt" = now() WHERE id = $${values.length + 1} RETURNING *`,
        [...values, args.where.id]
      );
      if (result.rows.length === 0) throw new Error(`Job not found: ${args.where.id}`);
      return result.rows[0];
    },

    async findUnique(args: { where: { id: string } }): Promise<JobRow | null> {
      const result = await pool.query<JobRow>(`SELECT * FROM "Job" WHERE id = $1`, [args.where.id]);
      return result.rows[0] ?? null;
    },

    async findUniqueOrThrow(args: { where: { id: string } }): Promise<JobRow> {
      const job = await db.job.findUnique(args);
      if (!job) throw new Error(`Job not found: ${args.where.id}`);
      return job;
    },

    async deleteMany(): Promise<void> {
      await pool.query(`DELETE FROM "Job"`);
    },
  },

  slide: {
    async create(data: {
      jobId: string;
      index: number;
      imagePath: string;
      extractedText: string;
      slideIntent?: string | null;
      recommendedSections?: string | null;
      confidence?: number | null;
      sections?: string | null;
      status?: string;
      error?: string | null;
    }): Promise<SlideRow> {
      const id = randomUUID();
      const result = await pool.query<SlideRow>(
        `INSERT INTO "Slide"
           (id, "jobId", "index", "imagePath", "extractedText", "slideIntent", "recommendedSections", confidence, sections, status, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          id,
          data.jobId,
          data.index,
          data.imagePath,
          data.extractedText,
          data.slideIntent ?? null,
          data.recommendedSections ?? null,
          data.confidence ?? null,
          data.sections ?? null,
          data.status ?? "pending",
          data.error ?? null,
        ]
      );
      return result.rows[0];
    },

    async update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<SlideRow> {
      const { clause, values } = buildSetClause(args.data, 1);
      const result = await pool.query<SlideRow>(
        `UPDATE "Slide" SET ${clause} WHERE id = $${values.length + 1} RETURNING *`,
        [...values, args.where.id]
      );
      if (result.rows.length === 0) throw new Error(`Slide not found: ${args.where.id}`);
      return result.rows[0];
    },

    async findUnique(args: { where: { id: string } }): Promise<SlideRow | null> {
      const result = await pool.query<SlideRow>(`SELECT * FROM "Slide" WHERE id = $1`, [args.where.id]);
      return result.rows[0] ?? null;
    },

    async findUniqueOrThrow(args: { where: { id: string } }): Promise<SlideRow> {
      const slide = await db.slide.findUnique(args);
      if (!slide) throw new Error(`Slide not found: ${args.where.id}`);
      return slide;
    },

    async findMany(args: {
      where: { jobId: string };
      orderBy?: { index: "asc" | "desc" };
    }): Promise<SlideRow[]> {
      const direction = args.orderBy?.index === "desc" ? "DESC" : "ASC";
      const result = await pool.query<SlideRow>(
        `SELECT * FROM "Slide" WHERE "jobId" = $1 ORDER BY "index" ${direction}`,
        [args.where.jobId]
      );
      return result.rows;
    },

    async deleteMany(): Promise<void> {
      await pool.query(`DELETE FROM "Slide"`);
    },
  },
};
```

- [ ] **Step 2: Delete the Prisma files**

```bash
git rm -r prisma/ prisma.config.ts
```

- [ ] **Step 3: Verify the project still typechecks (call sites not yet updated, so this is expected to fail on `prisma.` usages — confirm the *only* errors are unresolved `prisma` imports, not errors in `db.ts` itself)**

Run: `npx tsc --noEmit`
Expected: errors only in files that still import `prisma` from `@/lib/db` (worker.ts, API routes, guide page, tests) — no errors originating in `src/lib/db.ts`.

- [ ] **Step 4: Commit**

```bash
git add -A src/lib/db.ts prisma prisma.config.ts
git commit -m "Rewrite db.ts on pg, remove Prisma schema/config files"
```

---

### Task 4: Update all call sites, env files, and vitest config comment

**Files:**
- Modify: `src/lib/worker.ts`
- Modify: `src/app/guide/[jobId]/page.tsx`
- Modify: `src/app/api/jobs/[id]/route.ts`
- Modify: `src/app/api/slides/[id]/retry/route.ts`
- Modify: `src/app/api/slides/[id]/image/route.ts`
- Modify: `src/app/api/upload/route.ts`
- Modify: `tests/api/jobs.test.ts`
- Modify: `tests/api/retry.test.ts`
- Modify: `tests/api/upload.test.ts`
- Modify: `tests/lib/worker.test.ts`
- Modify: `tests/integration/pipeline.test.ts`
- Modify: `.env`
- Modify: `.env.example`
- Modify: `vitest.config.ts` (comment only)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `db` export from Task 3's `src/lib/db.ts`.

- [ ] **Step 1: Rename `prisma` → `db` in every call site**

In each of the following files, change `import { prisma } from "@/lib/db";` to `import { db } from "@/lib/db";` and change every `prisma.job.*` / `prisma.slide.*` call to `db.job.*` / `db.slide.*` (call arguments unchanged):

- `src/lib/worker.ts`
- `src/app/guide/[jobId]/page.tsx`
- `src/app/api/jobs/[id]/route.ts`
- `src/app/api/slides/[id]/retry/route.ts`
- `src/app/api/slides/[id]/image/route.ts`
- `src/app/api/upload/route.ts`
- `tests/api/jobs.test.ts`
- `tests/api/retry.test.ts`
- `tests/api/upload.test.ts`
- `tests/lib/worker.test.ts`
- `tests/integration/pipeline.test.ts`

- [ ] **Step 2: Update `.env`**

Replace the `DATABASE_URL` line:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/instructor_guide"
```

(Keep the existing `GEMINI_API_KEY` and `GEMINI_MODEL` lines unchanged.)

- [ ] **Step 3: Update `.env.example`**

Replace:

```
DATABASE_URL=file:./prisma/dev.db
```

with:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instructor_guide
```

- [ ] **Step 4: Update the `vitest.config.ts` comment**

The comment above `fileParallelism: false` currently says "Test files share a single SQLite database file". Update the wording to reflect Postgres while keeping the same reasoning and setting:

```ts
    // Test files share a single Postgres database and several suites
    // (e.g. worker + upload) issue blanket deleteMany() calls against the
    // same tables. Running files concurrently races those deletes against
    // each other's FK-referenced rows (Job/Slide), causing intermittent
    // failures. Serialize file execution to keep the shared DB
    // consistent across suites.
    fileParallelism: false,
```

- [ ] **Step 5: Clean up `.gitignore`**

Remove the now-stale Prisma-specific lines:

```
prisma/*.db
prisma/*.db-journal
```

(Leave the general `.env` line intact.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Run the full test suite against the Dockerized Postgres**

Run: `docker compose up -d` (if not already running)
Run: `npm test`
Expected: all suites pass (`tests/api/*.test.ts`, `tests/lib/*.test.ts`, `tests/integration/pipeline.test.ts` — the integration test self-skips if `soffice` isn't installed, that's pre-existing behavior, not a regression).

- [ ] **Step 8: Commit**

```bash
git add src/lib/worker.ts src/app/guide/\[jobId\]/page.tsx src/app/api tests .env.example vitest.config.ts .gitignore
git commit -m "Point all call sites, env files, and test config at Postgres"
```

---

### Task 5: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Confirm no Prisma references remain in source, tests, or config**

Run: `grep -rniI "prisma" --include="*.*" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=docs`
Expected: no output (the historical files under `docs/superpowers/specs` and `docs/superpowers/plans` are excluded deliberately — they're a record of past work, not live config).

- [ ] **Step 2: Confirm `package.json` has no leftover Prisma scripts or dependencies**

Run: `grep -i prisma package.json`
Expected: no output.

- [ ] **Step 3: Boot the dev server and smoke-test the upload → job → guide flow manually**

Run: `npm run dev`
Then in a browser: upload a `.pptx` (e.g. `tests/fixtures/sample.pptx` if present, or generate one via `node scripts/generate-fixture.mjs`), confirm the job progress page polls and redirects to `/guide/<jobId>`, and confirm slide cards render. This exercises `db.job.create`, `db.slide.create`, `db.job.update` (including the `completedSlides` increment path), and `db.slide.findMany` end-to-end against real Postgres — not just mocked test paths.

- [ ] **Step 4: Run the full test suite one more time to confirm a clean final state**

Run: `npm test`
Expected: all suites pass.
