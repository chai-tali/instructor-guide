import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker";
import { getStorageDir } from "@/lib/storage";

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pptx")) {
    return NextResponse.json({ error: "Only .pptx files are supported" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 50MB limit" }, { status: 400 });
  }

  const job = await db.job.create({ filename: file.name, status: "pending" });

  const jobDir = path.join(getStorageDir(), job.id);
  await fs.mkdir(jobDir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(jobDir, "original.pptx"), buffer);

  enqueueJob(job.id);

  return NextResponse.json({ jobId: job.id });
}
