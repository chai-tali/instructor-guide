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

describe("db.job guideTypes", () => {
  afterAll(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
  });

  it("defaults guideTypes to '[\"ig\"]' on create when omitted", async () => {
    const job = await db.job.create({ filename: "deck.pptx" });
    expect(job.guideTypes).toBe('["ig"]');
  });

  it("accepts an explicit guideTypes value on create", async () => {
    const job = await db.job.create({ filename: "deck.pptx", guideTypes: '["ig","sg"]' });
    expect(job.guideTypes).toBe('["ig","sg"]');
  });
});

describe("db.slide contentMode and sgSections", () => {
  afterAll(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
  });

  it("defaults contentMode and sgSections to null on create", async () => {
    const job = await db.job.create({ filename: "deck.pptx" });
    const slide = await db.slide.create({
      jobId: job.id,
      index: 0,
      imagePath: "/tmp/1.png",
      extractedText: "text",
    });
    expect(slide.contentMode).toBeNull();
    expect(slide.sgSections).toBeNull();
  });

  it("round-trips contentMode and sgSections through create and update", async () => {
    const job = await db.job.create({ filename: "deck.pptx" });
    const slide = await db.slide.create({
      jobId: job.id,
      index: 0,
      imagePath: "/tmp/1.png",
      extractedText: "text",
      contentMode: "VISUAL",
      sgSections: JSON.stringify([{ type: "coreExplanation", title: "Visual Walkthrough" }]),
    });
    expect(slide.contentMode).toBe("VISUAL");
    expect(JSON.parse(slide.sgSections!)).toEqual([{ type: "coreExplanation", title: "Visual Walkthrough" }]);

    const updated = await db.slide.update({
      where: { id: slide.id },
      data: { contentMode: "TEXTUAL" },
    });
    expect(updated.contentMode).toBe("TEXTUAL");
  });
});
