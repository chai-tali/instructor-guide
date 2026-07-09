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
