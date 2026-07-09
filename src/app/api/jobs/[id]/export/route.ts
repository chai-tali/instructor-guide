import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    await page.goto(`${baseUrl}/guide/${params.id}`, { waitUntil: "networkidle" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="instructor-guide-${params.id}.pdf"`,
      },
    });
  } finally {
    await browser.close();
  }
}
