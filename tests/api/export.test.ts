import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { GET } from "@/app/api/jobs/[id]/export/route";
import { NextRequest } from "next/server";
import path from "node:path";

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

  it("returns a downloadable docx for a job with slides", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "done" });
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
  });
});
