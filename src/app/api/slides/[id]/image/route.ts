import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slide = await db.slide.findUnique({ where: { id: params.id } });

  if (!slide) {
    return NextResponse.json({ error: "Slide not found" }, { status: 404 });
  }

  const buffer = await fs.readFile(slide.imagePath);
  return new NextResponse(buffer, { headers: { "Content-Type": "image/png" } });
}
