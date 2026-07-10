import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { GET } from "@/app/api/jobs/[id]/route";
import { NextRequest } from "next/server";

describe("GET /api/jobs/:id", () => {
  beforeEach(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
  });

  afterAll(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
  });

  it("returns 404 for an unknown job", async () => {
    const req = new NextRequest("http://localhost/api/jobs/unknown");
    const res = await GET(req, { params: { id: "unknown" } });
    expect(res.status).toBe(404);
  });

  it("returns job status fields", async () => {
    const job = await db.job.create({
      filename: "deck.pptx", status: "processing", totalSlides: 5, completedSlides: 2,
    });

    const req = new NextRequest(`http://localhost/api/jobs/${job.id}`);
    const res = await GET(req, { params: { id: job.id } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      status: "processing",
      totalSlides: 5,
      completedSlides: 2,
      error: null,
    });
  });
});
