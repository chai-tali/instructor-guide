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
  analyzeDeck: vi.fn(),
  classifyContentMode: vi.fn(),
  generateStudentGuide: vi.fn(),
}));

import { convertPptxToSlideImages } from "@/lib/conversion";
import { extractSlideTexts } from "@/lib/extraction";
import { analyzeSlide, generateGuide, analyzeDeck, classifyContentMode, generateStudentGuide } from "@/lib/gemini";
import { processJob } from "@/lib/worker";
import { db } from "@/lib/db";

describe("processJob", () => {
  let tmpDir: string;

  beforeEach(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ig-test-"));
    process.env.STORAGE_DIR = tmpDir;
    vi.mocked(convertPptxToSlideImages).mockReset();
    vi.mocked(extractSlideTexts).mockReset();
    vi.mocked(analyzeSlide).mockReset();
    vi.mocked(generateGuide).mockReset();
    vi.mocked(analyzeDeck).mockReset();
    vi.mocked(classifyContentMode).mockReset();
    vi.mocked(generateStudentGuide).mockReset();
    vi.mocked(analyzeDeck).mockResolvedValue({
      workshopTitle: null,
      duration: null,
      learningObjectives: [],
    });
  });

  afterAll(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
  });

  it("processes every slide and marks the job done", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "pending" });
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
      slideTitle: "Structured Prompting",
    });
    vi.mocked(generateGuide).mockResolvedValue({
      sections: [{ type: "trainerPointer", title: "Trainer Pointer", content: "Explain it." }],
    });

    await processJob(job.id);

    const updated = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe("done");
    expect(updated.completedSlides).toBe(2);

    const slides = await db.slide.findMany({
      where: { jobId: job.id },
      orderBy: { index: "asc" },
    });
    expect(slides).toHaveLength(2);
    expect(slides[0].status).toBe("done");
    expect(slides[0].slideTitle).toBe("Structured Prompting");
    expect(JSON.parse(slides[0].sections!)).toEqual([
      { type: "trainerPointer", title: "Trainer Pointer", content: "Explain it." },
    ]);
  });

  it("marks only the failing slide as failed and still completes the job", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "pending" });
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
        slideTitle: "Structured Prompting",
      })
      .mockRejectedValueOnce(new Error("Gemini timeout"));
    vi.mocked(generateGuide).mockResolvedValue({
      sections: [{ type: "trainerPointer", title: "Trainer Pointer", content: "Explain it." }],
    });

    await processJob(job.id);

    const updated = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe("done");

    const slides = await db.slide.findMany({
      where: { jobId: job.id },
      orderBy: { index: "asc" },
    });
    expect(slides.map((s) => s.status).sort()).toEqual(["done", "failed"]);
  });

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
      slideTitle: "Welcome",
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
    const deckError = new Error("Gemini timeout");
    vi.mocked(analyzeDeck).mockRejectedValue(deckError);
    vi.mocked(analyzeSlide).mockResolvedValue({
      slideIntent: "CONCEPT",
      recommendedSections: ["trainerPointer"],
      confidence: 0.9,
      slideTitle: "Structured Prompting",
    });
    vi.mocked(generateGuide).mockResolvedValue({
      sections: [{ type: "trainerPointer", title: "Trainer Pointer", content: "Explain it." }],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await processJob(job.id);

    const updated = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe("done");
    expect(updated.workshopTitle).toBeNull();
    expect(updated.duration).toBeNull();
    expect(updated.learningObjectives).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`analyzeDeck failed for job ${job.id}`),
      deckError
    );

    warnSpy.mockRestore();
  });

  it("only calls generateGuide (not SG) when guideTypes is ['ig']", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "pending", guideTypes: '["ig"]' });
    const slidesDir = path.join(tmpDir, job.id, "slides");
    await fs.mkdir(slidesDir, { recursive: true });
    await fs.writeFile(path.join(slidesDir, "1.png"), Buffer.from("fake-png"));

    vi.mocked(convertPptxToSlideImages).mockResolvedValue(1);
    vi.mocked(extractSlideTexts).mockResolvedValue(["Slide one text"]);
    vi.mocked(analyzeSlide).mockResolvedValue({
      slideIntent: "CONCEPT",
      recommendedSections: ["trainerPointer"],
      confidence: 0.9,
      slideTitle: "Structured Prompting",
    });
    vi.mocked(generateGuide).mockResolvedValue({
      sections: [{ type: "trainerPointer", title: "Trainer Pointer", content: "Explain it." }],
    });

    await processJob(job.id);

    expect(generateGuide).toHaveBeenCalledTimes(1);
    expect(classifyContentMode).not.toHaveBeenCalled();
    expect(generateStudentGuide).not.toHaveBeenCalled();

    const slides = await db.slide.findMany({ where: { jobId: job.id }, orderBy: { index: "asc" } });
    expect(slides[0].sgSections).toBeNull();
  });

  it("classifies content mode and generates SG sections for a teaching slide when guideTypes is ['sg']", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "pending", guideTypes: '["sg"]' });
    const slidesDir = path.join(tmpDir, job.id, "slides");
    await fs.mkdir(slidesDir, { recursive: true });
    await fs.writeFile(path.join(slidesDir, "1.png"), Buffer.from("fake-png"));

    vi.mocked(convertPptxToSlideImages).mockResolvedValue(1);
    vi.mocked(extractSlideTexts).mockResolvedValue(["CAP theorem slide text"]);
    vi.mocked(analyzeSlide).mockResolvedValue({
      slideIntent: "CONCEPT",
      recommendedSections: ["trainerPointer"],
      confidence: 0.9,
      slideTitle: "CAP Theorem",
    });
    vi.mocked(classifyContentMode).mockResolvedValue("TEXTUAL");
    vi.mocked(generateStudentGuide).mockResolvedValue({
      sections: [
        { type: "coreExplanation", title: "Concept Explanation", content: "CAP is about trade-offs." },
        { type: "rememberThis", title: "Remember This", keyPoints: ["Partition tolerance is non-negotiable."] },
      ],
    });

    await processJob(job.id);

    expect(generateGuide).not.toHaveBeenCalled();
    expect(classifyContentMode).toHaveBeenCalledWith("ZmFrZS1wbmc=", "CAP theorem slide text");
    expect(generateStudentGuide).toHaveBeenCalledWith("ZmFrZS1wbmc=", "CAP theorem slide text", "CONCEPT", "TEXTUAL");

    const slides = await db.slide.findMany({ where: { jobId: job.id }, orderBy: { index: "asc" } });
    expect(slides[0].contentMode).toBe("TEXTUAL");
    expect(JSON.parse(slides[0].sgSections!)).toEqual([
      { type: "coreExplanation", title: "Concept Explanation", content: "CAP is about trade-offs." },
      { type: "rememberThis", title: "Remember This", keyPoints: ["Partition tolerance is non-negotiable."] },
    ]);
    expect(slides[0].sections).toBeNull();
  });

  it("skips classifyContentMode and passes null contentMode for a non-teaching slide", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "pending", guideTypes: '["sg"]' });
    const slidesDir = path.join(tmpDir, job.id, "slides");
    await fs.mkdir(slidesDir, { recursive: true });
    await fs.writeFile(path.join(slidesDir, "1.png"), Buffer.from("fake-png"));

    vi.mocked(convertPptxToSlideImages).mockResolvedValue(1);
    vi.mocked(extractSlideTexts).mockResolvedValue(["Thank you for attending"]);
    vi.mocked(analyzeSlide).mockResolvedValue({
      slideIntent: "THANK_YOU",
      recommendedSections: [],
      confidence: 0.95,
      slideTitle: "Thank You",
    });
    vi.mocked(generateStudentGuide).mockResolvedValue({
      sections: [{ type: "coreExplanation", title: "Concept Explanation", content: "This slide closes the session." }],
    });

    await processJob(job.id);

    expect(classifyContentMode).not.toHaveBeenCalled();
    expect(generateStudentGuide).toHaveBeenCalledWith("ZmFrZS1wbmc=", "Thank you for attending", "THANK_YOU", null);

    const slides = await db.slide.findMany({ where: { jobId: job.id }, orderBy: { index: "asc" } });
    expect(slides[0].contentMode).toBeNull();
    expect(JSON.parse(slides[0].sgSections!)).toEqual([
      { type: "coreExplanation", title: "Concept Explanation", content: "This slide closes the session." },
    ]);
  });

  it("generates both IG and SG sections when guideTypes is ['ig','sg']", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "pending", guideTypes: '["ig","sg"]' });
    const slidesDir = path.join(tmpDir, job.id, "slides");
    await fs.mkdir(slidesDir, { recursive: true });
    await fs.writeFile(path.join(slidesDir, "1.png"), Buffer.from("fake-png"));

    vi.mocked(convertPptxToSlideImages).mockResolvedValue(1);
    vi.mocked(extractSlideTexts).mockResolvedValue(["Slide text"]);
    vi.mocked(analyzeSlide).mockResolvedValue({
      slideIntent: "CONCEPT",
      recommendedSections: ["trainerPointer"],
      confidence: 0.9,
      slideTitle: "A Concept",
    });
    vi.mocked(generateGuide).mockResolvedValue({
      sections: [{ type: "trainerPointer", title: "Trainer Pointer", content: "Explain it." }],
    });
    vi.mocked(classifyContentMode).mockResolvedValue("VISUAL");
    vi.mocked(generateStudentGuide).mockResolvedValue({
      sections: [{ type: "coreExplanation", title: "Visual Walkthrough", content: "The chart shows X." }],
    });

    await processJob(job.id);

    const slides = await db.slide.findMany({ where: { jobId: job.id }, orderBy: { index: "asc" } });
    expect(JSON.parse(slides[0].sections!)).toEqual([
      { type: "trainerPointer", title: "Trainer Pointer", content: "Explain it." },
    ]);
    expect(JSON.parse(slides[0].sgSections!)).toEqual([
      { type: "coreExplanation", title: "Visual Walkthrough", content: "The chart shows X." },
    ]);
  });
});
