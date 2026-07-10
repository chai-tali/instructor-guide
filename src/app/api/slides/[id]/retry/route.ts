import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { processSlide } from "@/lib/worker";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slide = await db.slide.findUnique({ where: { id: params.id } });

  if (!slide) {
    return NextResponse.json({ error: "Slide not found" }, { status: 404 });
  }

  await processSlide(slide.id, slide.jobId);

  return NextResponse.json({ ok: true });
}
