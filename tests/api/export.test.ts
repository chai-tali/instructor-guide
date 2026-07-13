import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { GET } from "@/app/api/jobs/[id]/export/route";
import { NextRequest } from "next/server";
import path from "node:path";
import JSZip from "jszip";

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

  it("returns 404 for a job that exists but has no slides yet", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "processing" });

    const req = new NextRequest(`http://localhost/api/jobs/${job.id}/export`);
    const res = await GET(req, { params: { id: job.id } });

    expect(res.status).toBe(404);
  });

  it("returns a downloadable docx titled after the uploaded filename", async () => {
    const job = await db.job.create({ filename: "My Deck.pptx", status: "done" });
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

    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain("My Deck");
    expect(documentXml).not.toContain("My Deck.pptx");
  });

  it("uses the job's generated workshopTitle, duration, and learning objectives when present", async () => {
    const job = await db.job.create({ filename: "My Deck.pptx", status: "done" });
    await db.job.update({
      where: { id: job.id },
      data: {
        workshopTitle: "AI in Practice",
        duration: "4:00 PM to 6:30 PM",
        learningObjectives: JSON.stringify(["Understand prompting fundamentals"]),
      },
    });
    await db.slide.create({
      jobId: job.id,
      index: 0,
      imagePath: path.join(process.cwd(), "tests/fixtures/sample-slide.png"),
      extractedText: "Welcome",
      status: "done",
    });

    const req = new NextRequest(`http://localhost/api/jobs/${job.id}/export`);
    const res = await GET(req, { params: { id: job.id } });

    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain("AI in Practice");
    expect(documentXml).toContain("4:00 PM to 6:30 PM");
    expect(documentXml).toContain("Understand prompting fundamentals");
  });
});
