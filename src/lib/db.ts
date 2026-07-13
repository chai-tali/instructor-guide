import { Pool } from "pg";
import { randomUUID } from "node:crypto";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export const pool = globalThis.__pgPool ?? new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalThis.__pgPool = pool;
}

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
  slideTitle: string | null;
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
      if (!clause) throw new Error("update() requires at least one field to set");
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
      if (!clause) throw new Error("update() requires at least one field to set");
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
