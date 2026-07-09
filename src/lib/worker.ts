import pLimit from "p-limit";
import path from "node:path";
import fs from "node:fs/promises";
import { prisma } from "@/lib/db";
import { convertPptxToSlideImages } from "@/lib/conversion";
import { extractSlideTexts } from "@/lib/extraction";
import { analyzeSlide, generateGuide } from "@/lib/gemini";
import { getStorageDir } from "@/lib/storage";
import type { SlideIntent, SectionKey } from "@/types/guide";

const jobQueue: string[] = [];
let processing = false;

export function enqueueJob(jobId: string): void {
  jobQueue.push(jobId);
  void drainQueue();
}

async function drainQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  while (jobQueue.length > 0) {
    const jobId = jobQueue.shift()!;
    await processJob(jobId);
  }
  processing = false;
}

export async function processJob(jobId: string): Promise<void> {
  const jobDir = path.join(getStorageDir(), jobId);
  const pptxPath = path.join(jobDir, "original.pptx");
  const slidesDir = path.join(jobDir, "slides");

  try {
    await prisma.job.update({ where: { id: jobId }, data: { status: "processing" } });

    const slideCount = await convertPptxToSlideImages(pptxPath, slidesDir);
    const texts = await extractSlideTexts(pptxPath);

    await prisma.job.update({ where: { id: jobId }, data: { totalSlides: slideCount } });

    const slideRecords = await Promise.all(
      Array.from({ length: slideCount }, (_, index) =>
        prisma.slide.create({
          data: {
            jobId,
            index,
            imagePath: path.join(slidesDir, `${index + 1}.png`),
            extractedText: texts[index] ?? "",
            status: "pending",
          },
        })
      )
    );

    const limit = pLimit(3);
    await Promise.all(
      slideRecords.map((slide) => limit(() => processSlide(slide.id, jobId)))
    );

    await prisma.job.update({ where: { id: jobId }, data: { status: "done" } });
  } catch (err) {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "failed", error: (err as Error).message },
    });
  }
}

export async function processSlide(slideId: string, jobId: string): Promise<void> {
  const slide = await prisma.slide.findUniqueOrThrow({ where: { id: slideId } });

  try {
    await prisma.slide.update({ where: { id: slideId }, data: { status: "processing" } });

    const imageBase64 = (await fs.readFile(slide.imagePath)).toString("base64");
    const analysis = await analyzeSlide(imageBase64, slide.extractedText);
    const guide = await generateGuide(
      imageBase64,
      slide.extractedText,
      analysis.slideIntent as SlideIntent,
      analysis.recommendedSections as SectionKey[]
    );

    await prisma.slide.update({
      where: { id: slideId },
      data: {
        slideIntent: analysis.slideIntent,
        recommendedSections: JSON.stringify(analysis.recommendedSections),
        confidence: analysis.confidence,
        sections: JSON.stringify(guide.sections),
        status: "done",
      },
    });
  } catch (err) {
    await prisma.slide.update({
      where: { id: slideId },
      data: { status: "failed", error: (err as Error).message },
    });
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { completedSlides: { increment: 1 } },
  });
}
