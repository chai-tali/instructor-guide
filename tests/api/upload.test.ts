import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { NextRequest } from "next/server";

vi.mock("@/lib/worker", () => ({
  enqueueJob: vi.fn(),
}));

import { enqueueJob } from "@/lib/worker";
import { db } from "@/lib/db";
import { POST } from "@/app/api/upload/route";

describe("POST /api/upload", () => {
  let tmpDir: string;

  beforeEach(async () => {
    await db.job.deleteMany();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ig-upload-"));
    process.env.STORAGE_DIR = tmpDir;
    vi.mocked(enqueueJob).mockReset();
  });

  afterAll(async () => {
    await db.job.deleteMany();
  });

  it("rejects non-pptx files", async () => {
    const formData = new FormData();
    formData.append("file", new File(["hello"], "notes.txt", { type: "text/plain" }));
    const req = new NextRequest("http://localhost/api/upload", { method: "POST", body: formData });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("creates a job, saves the file, and enqueues processing", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File(["fake pptx bytes"], "deck.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      })
    );
    const req = new NextRequest("http://localhost/api/upload", { method: "POST", body: formData });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.jobId).toBeTruthy();

    const job = await db.job.findUniqueOrThrow({ where: { id: body.jobId } });
    expect(job.filename).toBe("deck.pptx");
    expect(job.status).toBe("pending");

    const savedFile = await fs.readFile(path.join(tmpDir, body.jobId, "original.pptx"));
    expect(savedFile.toString()).toBe("fake pptx bytes");

    expect(enqueueJob).toHaveBeenCalledWith(body.jobId);
  });

  it("stores the requested guideTypes when valid", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File(["fake pptx bytes"], "deck.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      })
    );
    formData.append("guideTypes", '["ig","sg"]');
    const req = new NextRequest("http://localhost/api/upload", { method: "POST", body: formData });

    const res = await POST(req);
    const body = await res.json();

    const job = await db.job.findUniqueOrThrow({ where: { id: body.jobId } });
    expect(job.guideTypes).toBe('["ig","sg"]');
  });

  it("defaults guideTypes to ['ig'] when the field is missing", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File(["fake pptx bytes"], "deck.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      })
    );
    const req = new NextRequest("http://localhost/api/upload", { method: "POST", body: formData });

    const res = await POST(req);
    const body = await res.json();

    const job = await db.job.findUniqueOrThrow({ where: { id: body.jobId } });
    expect(job.guideTypes).toBe('["ig"]');
  });

  it("defaults guideTypes to ['ig'] when the field is malformed or empty", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File(["fake pptx bytes"], "deck.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      })
    );
    formData.append("guideTypes", "[]");
    const req = new NextRequest("http://localhost/api/upload", { method: "POST", body: formData });

    const res = await POST(req);
    const body = await res.json();

    const job = await db.job.findUniqueOrThrow({ where: { id: body.jobId } });
    expect(job.guideTypes).toBe('["ig"]');
  });
});
