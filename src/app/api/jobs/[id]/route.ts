import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const job = await db.job.findUnique({ where: { id: params.id } });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    totalSlides: job.totalSlides,
    completedSlides: job.completedSlides,
    error: job.error,
  });
}
