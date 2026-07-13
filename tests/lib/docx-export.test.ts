import { describe, it, expect } from "vitest";
import path from "node:path";
import JSZip from "jszip";
import { buildInstructorGuideDocx, stripPptxExtension } from "@/lib/docx-export";
import type { JobRow, SlideRow } from "@/lib/db";
import { TRAINER_GUIDELINES_DOS, TRAINER_GUIDELINES_DONTS, MATERIAL_REQUIRED_ITEMS } from "@/lib/static-guide-content";

function fakeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    filename: "My Deck.pptx",
    status: "done",
    totalSlides: 1,
    completedSlides: 1,
    error: null,
    workshopTitle: null,
    duration: null,
    learningObjectives: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeSlide(overrides: Partial<SlideRow> = {}): SlideRow {
  return {
    id: "slide-1",
    jobId: "job-1",
    index: 0,
    imagePath: path.join(process.cwd(), "tests/fixtures/sample-slide.png"),
    extractedText: "Welcome",
    slideIntent: null,
    recommendedSections: null,
    confidence: null,
    sections: null,
    status: "done",
    error: null,
    ...overrides,
  };
}

async function documentXmlOf(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  // docx escapes apostrophes/quotes as XML entities in text nodes; decode them
  // so assertions can match against the plain-text source strings.
  return xml
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

describe("stripPptxExtension", () => {
  it("strips a .pptx extension", () => {
    expect(stripPptxExtension("My Deck.pptx")).toBe("My Deck");
  });

  it("strips a .PPTX extension case-insensitively", () => {
    expect(stripPptxExtension("My Deck.PPTX")).toBe("My Deck");
  });

  it("leaves a filename without a .pptx extension unchanged", () => {
    expect(stripPptxExtension("My Deck")).toBe("My Deck");
  });
});

describe("buildInstructorGuideDocx front matter", () => {
  it("falls back to the filename as title when workshopTitle is null", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob({ workshopTitle: null }), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("My Deck");
  });

  it("uses workshopTitle over the filename when present", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob({ workshopTitle: "AI in Practice" }), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("AI in Practice");
    expect(xml).not.toContain("My Deck");
  });

  it("renders a blank duration when none was found", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob({ duration: null }), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Duration:");
  });

  it("renders the exact duration text when present", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob({ duration: "2 hours" }), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Duration:");
    expect(xml).toContain("2 hours");
  });

  it("renders one bullet per learning objective", async () => {
    const buffer = await buildInstructorGuideDocx(
      fakeJob({
        learningObjectives: JSON.stringify(["Understand prompting", "Apply the five-block structure"]),
      }),
      [fakeSlide()]
    );
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Understand prompting");
    expect(xml).toContain("Apply the five-block structure");
  });

  it("renders an empty Learning Objectives section when none were generated", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob({ learningObjectives: null }), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Learning Objectives");
  });

  it("renders the static Trainer Guidelines table content", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Trainer Guidelines");
    expect(xml).toContain(TRAINER_GUIDELINES_DOS[0]);
    expect(xml).toContain(TRAINER_GUIDELINES_DONTS[0]);
  });

  it("renders the static Material Required section", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Material Required for the Workshop");
    expect(xml).toContain(MATERIAL_REQUIRED_ITEMS[0]);
  });

  it("renders a Session Guide heading before the per-slide content", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    const sessionGuideIndex = xml.indexOf("Session Guide");
    const slideHeadingIndex = xml.indexOf("Slide 1");
    expect(sessionGuideIndex).toBeGreaterThan(-1);
    expect(slideHeadingIndex).toBeGreaterThan(sessionGuideIndex);
  });
});
