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
    slideTitle: null,
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
  analyzeDeck: vi.fn().mockResolvedValue({
    workshopTitle: null,
    duration: null,
    learningObjectives: [],
  }),
  classifyContentMode: vi.fn().mockResolvedValue("TEXTUAL"),
  generateStudentGuide: vi.fn().mockImplementation(async (_img: string, _text: string, _intent: string, contentMode: string | null) => ({
    sections:
      _intent === "THANK_YOU"
        ? [{ type: "coreExplanation", title: "Concept Explanation", content: "SG content" }]
        : [
            { type: "coreExplanation", title: "Concept Explanation", content: "SG content" },
            { type: "rememberThis", title: "Remember This", keyPoints: ["Point one."] },
          ],
  })),
}));

import { processJob } from "@/lib/worker";
import { db } from "@/lib/db";

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
    await db.slide.deleteMany();
    await db.job.deleteMany();
  });

  it("takes a fixture deck from upload through completed slides", async () => {
    if (!(await hasSoffice())) {
      console.warn("Skipping: soffice not installed in this environment");
      return;
    }

    const job = await db.job.create({ filename: "sample.pptx", status: "pending" });
    const jobDir = path.join(tmpDir, job.id);
    await fs.mkdir(jobDir, { recursive: true });
    await fs.copyFile(
      path.join(process.cwd(), "tests/fixtures/sample.pptx"),
      path.join(jobDir, "original.pptx")
    );

    await processJob(job.id);

    const updated = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe("done");
    expect(updated.totalSlides).toBe(3);

    const slides = await db.slide.findMany({
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

  it("generates SG-only content when guideTypes is ['sg']", async () => {
    if (!(await hasSoffice())) {
      console.warn("Skipping: soffice not installed in this environment");
      return;
    }

    const job = await db.job.create({ filename: "sample.pptx", status: "pending", guideTypes: '["sg"]' });
    const jobDir = path.join(tmpDir, job.id);
    await fs.mkdir(jobDir, { recursive: true });
    await fs.copyFile(
      path.join(process.cwd(), "tests/fixtures/sample.pptx"),
      path.join(jobDir, "original.pptx")
    );

    await processJob(job.id);

    const slides = await db.slide.findMany({ where: { jobId: job.id }, orderBy: { index: "asc" } });
    expect(slides).toHaveLength(3);
    expect(slides[0].sections).toBeNull();
    expect(JSON.parse(slides[0].sgSections!)).toEqual([
      { type: "coreExplanation", title: "Concept Explanation", content: "SG content" },
      { type: "rememberThis", title: "Remember This", keyPoints: ["Point one."] },
    ]);
    // slides[2] is the THANK_YOU slide -> non-teaching -> coreExplanation only
    expect(JSON.parse(slides[2].sgSections!)).toEqual([
      { type: "coreExplanation", title: "Concept Explanation", content: "SG content" },
    ]);
  });
});
