import fs from "node:fs/promises";
import path from "node:path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  Header,
  Footer,
  PageNumber,
  Tab,
  TabStopType,
  TabStopPosition,
  AlignmentType,
} from "docx";
import type { JobRow, SlideRow } from "@/lib/db";
import { sectionDisplayTitle } from "@/types/guide";
import type { GuideSection } from "@/types/guide";
import { parseMarkdownLite } from "@/lib/markdown-lite";
import type { MarkdownBlock } from "@/lib/markdown-lite";
import {
  TRAINER_GUIDELINES_DOS,
  TRAINER_GUIDELINES_DONTS,
  MATERIAL_REQUIRED_ITEMS,
  TRAINING_AIDS_ITEMS,
  TRAINING_VIDEO_ITEMS,
} from "@/lib/static-guide-content";

const MAX_IMAGE_WIDTH = 600;
const LOGO_PATH = path.join(process.cwd(), "logo", "niit.png");
const LOGO_HEADER_WIDTH = 120;
const FOOTER_TEXT = "All rights reserved © NIIT Ltd.";

export function stripPptxExtension(filename: string): string {
  return filename.replace(/\.pptx$/i, "");
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function scaledDimensions(
  width: number,
  height: number,
  maxWidth: number = MAX_IMAGE_WIDTH
): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  const scale = maxWidth / width;
  return { width: maxWidth, height: Math.round(height * scale) };
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

function bulletParagraphs(items: string[]): Paragraph[] {
  return items.map(
    (item) =>
      new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun(item)],
      })
  );
}

function sectionToParagraphs(section: GuideSection): Paragraph[] {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun(sectionDisplayTitle(section))],
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

  if (section.keyPoints && section.keyPoints.length > 0) {
    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("Key Points")],
      })
    );
    paragraphs.push(...bulletParagraphs(section.keyPoints));
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

function twoColumnCell(text: string, bold = false): TableCell {
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  });
}

function trainerGuidelinesTable(): Table {
  const rowCount = Math.max(TRAINER_GUIDELINES_DOS.length, TRAINER_GUIDELINES_DONTS.length);

  const headerRow = new TableRow({
    children: [twoColumnCell("Do's", true), twoColumnCell("Don'ts", true)],
  });

  const bodyRows = Array.from(
    { length: rowCount },
    (_, i) =>
      new TableRow({
        children: [
          twoColumnCell(TRAINER_GUIDELINES_DOS[i] ?? ""),
          twoColumnCell(TRAINER_GUIDELINES_DONTS[i] ?? ""),
        ],
      })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  });
}

function heading(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}

function frontMatter(job: JobRow): (Paragraph | Table)[] {
  const title = job.workshopTitle ?? stripPptxExtension(job.filename);
  const learningObjectives: string[] = job.learningObjectives ? JSON.parse(job.learningObjectives) : [];

  return [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }),
    new Paragraph({ children: [new TextRun(`Duration: ${job.duration ?? ""}`)] }),
    heading("Learning Objectives"),
    ...bulletParagraphs(learningObjectives),
    heading("Trainer Guidelines"),
    trainerGuidelinesTable(),
    heading("Material Required for the Workshop"),
    ...bulletParagraphs(MATERIAL_REQUIRED_ITEMS),
    heading("Training Aids for the Workshop"),
    ...bulletParagraphs(TRAINING_AIDS_ITEMS),
    heading("Training videos and important links"),
    ...bulletParagraphs(TRAINING_VIDEO_ITEMS),
    heading("Session Guide"),
  ];
}

async function buildHeader(): Promise<Header> {
  const logoBuffer = await fs.readFile(LOGO_PATH);
  const { width: rawWidth, height: rawHeight } = readPngDimensions(logoBuffer);
  const { width, height } = scaledDimensions(rawWidth, rawHeight, LOGO_HEADER_WIDTH);

  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new ImageRun({
            data: logoBuffer,
            transformation: { width, height },
            type: "png",
          }),
        ],
      }),
    ],
  });
}

function buildFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [
          new TextRun(FOOTER_TEXT),
          new TextRun({ children: [new Tab(), PageNumber.CURRENT, "/", PageNumber.TOTAL_PAGES] }),
        ],
      }),
    ],
  });
}

export async function buildInstructorGuideDocx(job: JobRow, slides: SlideRow[]): Promise<Buffer> {
  const [slideParagraphs, header] = await Promise.all([
    Promise.all(slides.map(slideToParagraphs)),
    buildHeader(),
  ]);
  const footer = buildFooter();

  const doc = new Document({
    title: job.workshopTitle ?? stripPptxExtension(job.filename),
    sections: [
      {
        headers: { default: header },
        footers: { default: footer },
        children: [...frontMatter(job), ...slideParagraphs.flat()],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
