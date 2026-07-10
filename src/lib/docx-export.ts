import fs from "node:fs/promises";
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } from "docx";
import type { SlideRow } from "@/lib/db";
import { SECTION_TITLES } from "@/types/guide";
import type { GuideSection } from "@/types/guide";
import { parseMarkdownLite } from "@/lib/markdown-lite";
import type { MarkdownBlock } from "@/lib/markdown-lite";

const MAX_IMAGE_WIDTH = 600;

export function stripPptxExtension(filename: string): string {
  return filename.replace(/\.pptx$/i, "");
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function scaledDimensions(width: number, height: number): { width: number; height: number } {
  if (width <= MAX_IMAGE_WIDTH) return { width, height };
  const scale = MAX_IMAGE_WIDTH / width;
  return { width: MAX_IMAGE_WIDTH, height: Math.round(height * scale) };
}

function markdownBlocksToParagraphs(blocks: MarkdownBlock[]): Paragraph[] {
  return blocks.map(
    (block) =>
      new Paragraph({
        bullet: block.type === "bullet" ? { level: 0 } : undefined,
        children: block.runs.map((run) => new TextRun({ text: run.text, bold: run.bold })),
      })
  );
}

function sectionToParagraphs(section: GuideSection): Paragraph[] {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun(section.title || SECTION_TITLES[section.type] || section.type)],
    }),
  ];

  if (section.content) {
    paragraphs.push(...markdownBlocksToParagraphs(parseMarkdownLite(section.content)));
  }

  if (section.items) {
    for (const item of section.items) {
      if (item.question !== "bullet") {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: `${item.question}: `, bold: true })],
          })
        );
      }
      paragraphs.push(...markdownBlocksToParagraphs(parseMarkdownLite(item.answer)));
    }
  }

  return paragraphs;
}

async function slideToParagraphs(slide: SlideRow): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(`Slide ${slide.index + 1}`)],
    }),
  ];

  const imageBuffer = await fs.readFile(slide.imagePath);
  const { width: rawWidth, height: rawHeight } = readPngDimensions(imageBuffer);
  const { width, height } = scaledDimensions(rawWidth, rawHeight);

  paragraphs.push(
    new Paragraph({
      children: [
        new ImageRun({
          data: imageBuffer,
          transformation: { width, height },
          type: "png",
        }),
      ],
    })
  );

  if (slide.status === "failed") {
    paragraphs.push(
      new Paragraph({ children: [new TextRun("This slide failed to generate.")] })
    );
  }

  const sections: GuideSection[] = slide.sections ? JSON.parse(slide.sections) : [];
  for (const section of sections) {
    paragraphs.push(...sectionToParagraphs(section));
  }

  return paragraphs;
}

export async function buildInstructorGuideDocx(slides: SlideRow[], title: string): Promise<Buffer> {
  const slideParagraphs = await Promise.all(slides.map(slideToParagraphs));

  const doc = new Document({
    title,
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun(title)],
          }),
          ...slideParagraphs.flat(),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
