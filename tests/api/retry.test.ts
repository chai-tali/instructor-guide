import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/worker", () => ({
  processSlide: vi.fn(),
}));

import { processSlide } from "@/lib/worker";
import { db } from "@/lib/db";
import { POST } from "@/app/api/slides/[id]/retry/route";

describe("POST /api/slides/:id/retry", () => {
  beforeEach(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
    vi.mocked(processSlide).mockReset();
  });

  afterAll(async () => {
    await db.slide.deleteMany();
    await db.job.deleteMany();
  });

  it("returns 404 for an unknown slide", async () => {
    const req = new NextRequest("http://localhost/api/slides/unknown/retry", { method: "POST" });
    const res = await POST(req, { params: { id: "unknown" } });
    expect(res.status).toBe(404);
  });

  it("re-processes an existing slide", async () => {
    const job = await db.job.create({ filename: "deck.pptx", status: "done" });
    const slide = await db.slide.create({
      jobId: job.id,
      index: 0,
      imagePath: "/tmp/1.png",
      extractedText: "text",
      status: "failed",
    });

    const req = new NextRequest(`http://localhost/api/slides/${slide.id}/retry`, { method: "POST" });
    const res = await POST(req, { params: { id: slide.id } });

    expect(res.status).toBe(200);
    expect(processSlide).toHaveBeenCalledWith(slide.id, job.id);
  });
});
