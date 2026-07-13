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
