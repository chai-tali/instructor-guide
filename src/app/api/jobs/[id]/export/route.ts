import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildInstructorGuideDocx } from "@/lib/docx-export";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slides = await db.slide.findMany({
    where: { jobId: params.id },
    orderBy: { index: "asc" },
  });

  if (slides.length === 0) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const buffer = await buildInstructorGuideDocx(slides);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="instructor-guide-${params.id}.docx"`,
    },
  });
}
