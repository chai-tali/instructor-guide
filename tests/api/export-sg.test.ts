import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { GET } from "@/app/api/jobs/[id]/export/sg/route";
import { NextRequest } from "next/server";
import path from "node:path";
import JSZip from "jszip";

describe("GET /api/jobs/:id/export/sg", () => {
  beforeEach(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
  });

  afterAll(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
  });

  it("returns 404 for an unknown job", async () => {
    const req = new NextRequest("http://localhost/api/jobs/unknown/export/sg");
    const res = await GET(req, { params: { id: "unknown" } });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a job that exists but has no slides yet", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "processing", guideTypes: '["sg"]' });

    const req = new NextRequest(`http://localhost/api/jobs/${job.id}/export/sg`);
    const res = await GET(req, { params: { id: job.id } });

    expect(res.status).toBe(404);
  });

  it("returns a downloadable student-guide docx", async () => {
    const job = await db.job.create({ filename: "My Deck.pptx", status: "done", guideTypes: '["sg"]' });
    await db.slide.create({
      jobId: job.id,
      index: 0,
      imagePath: path.join(process.cwd(), "tests/fixtures/sample-slide.png"),
      extractedText: "Welcome",
      status: "done",
      sgSections: JSON.stringify([
        { type: "coreExplanation", title: "Concept Explanation", content: "This slide welcomes the class." },
      ]),
    });

    const req = new NextRequest(`http://localhost/api/jobs/${job.id}/export/sg`);
    const res = await GET(req, { params: { id: job.id } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(res.headers.get("Content-Disposition")).toContain(`student-guide-${job.id}.docx`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain("This slide welcomes the class.");
  });
});
