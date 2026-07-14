import { describe, it, expect } from "vitest";
import path from "node:path";
import JSZip from "jszip";
import { buildInstructorGuideDocx, buildStudentGuideDocx, stripPptxExtension } from "@/lib/docx-export";
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
    guideTypes: '["ig","sg"]',
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
    contentMode: null,
    sgSections: null,
    slideTitle: null,
    status: "done",
    error: null,
    ...overrides,
  };
}

function decodeXmlEntities(xml: string): string {
  return xml
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function documentXmlOf(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  // docx escapes apostrophes/quotes as XML entities in text nodes; decode them
  // so assertions can match against the plain-text source strings.
  return decodeXmlEntities(xml);
}

async function headerXmlOf(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/header1.xml")!.async("string");
  return decodeXmlEntities(xml);
}

async function footerXmlOf(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/footer1.xml")!.async("string");
  return decodeXmlEntities(xml);
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

  it("appends the slide title to the slide heading when present", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [
      fakeSlide({ slideTitle: "Structured Prompting for Financial Analysis" }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Slide 1: Structured Prompting for Financial Analysis");
  });

  it("renders just the slide number when slideTitle is null", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [fakeSlide({ slideTitle: null })]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Slide 1");
    expect(xml).not.toContain("Slide 1:");
  });

  it("renders a Key Points sub-heading with bullets under Trainer Pointer", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [
      fakeSlide({
        sections: JSON.stringify([
          {
            type: "trainerPointer",
            title: "Trainer Pointer",
            content: "Welcome the class.",
            keyPoints: ["Sets a collaborative tone.", "Establishes the agenda."],
          },
        ]),
      }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Key Points");
    expect(xml).toContain("Sets a collaborative tone.");
    expect(xml).toContain("Establishes the agenda.");
  });

  it("does not render a Key Points heading when trainerPointer has no keyPoints", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [
      fakeSlide({
        sections: JSON.stringify([
          { type: "trainerPointer", title: "Trainer Pointer", content: "Welcome the class." },
        ]),
      }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).not.toContain("Key Points");
  });

  it("renders keyPoints bullets without a Key Points heading for a non-trainerPointer section", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [
      fakeSlide({
        sections: JSON.stringify([
          {
            type: "mentalModel",
            title: "Mental Model",
            content: "Think of it like a filing system.",
            keyPoints: ["Folders group related items.", "Labels make retrieval fast."],
          },
        ]),
      }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).not.toContain("Key Points");
    expect(xml).toContain("Folders group related items.");
    expect(xml).toContain("Labels make retrieval fast.");
  });

  it("renders the Relevance of the Slide heading for a howThisFits section", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [
      fakeSlide({
        sections: JSON.stringify([
          { type: "howThisFits", title: "", content: "This slide connects to the next module." },
        ]),
      }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Relevance of the Slide");
    expect(xml).not.toContain("How This Fits");
  });

  it("prefers the canonical title over Gemini's own generated title for a known section type", async () => {
    // Gemini always fills in its own `title` field (the response schema requires it),
    // so a howThisFits section from a real Gemini response still arrives with the old
    // "How This Fits" title text even after SECTION_TITLES was renamed. The renderer
    // must use SECTION_TITLES over Gemini's title for any type it recognizes.
    const buffer = await buildInstructorGuideDocx(fakeJob(), [
      fakeSlide({
        sections: JSON.stringify([
          { type: "howThisFits", title: "How This Fits", content: "This slide connects to the next module." },
        ]),
      }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Relevance of the Slide");
    expect(xml).not.toContain("How This Fits");
  });

  it("renders the Key Takeaways heading for a keyTakeaways section", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [
      fakeSlide({
        sections: JSON.stringify([
          {
            type: "keyTakeaways",
            title: "",
            content: "Walk participants through each takeaway listed on the slide.",
          },
        ]),
      }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Key Takeaways");
    expect(xml).toContain("Walk participants through each takeaway listed on the slide.");
  });
});

describe("buildInstructorGuideDocx header and footer", () => {
  it("renders the logo right-aligned in the header", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [fakeSlide()]);
    const xml = await headerXmlOf(buffer);
    expect(xml).toContain('<w:jc w:val="right"/>');
    expect(xml).toContain("<w:drawing>");
  });

  it("embeds the logo image as media in the docx", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [fakeSlide()]);
    const zip = await JSZip.loadAsync(buffer);
    const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith("word/media/"));
    expect(mediaFiles.length).toBeGreaterThan(0);
  });

  it("renders 'All rights reserved © NIIT Ltd.' on the left of the footer", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [fakeSlide()]);
    const xml = await footerXmlOf(buffer);
    expect(xml).toContain("All rights reserved © NIIT Ltd.");
  });

  it("renders a right-aligned page/total-page number field in the footer", async () => {
    const buffer = await buildInstructorGuideDocx(fakeJob(), [fakeSlide()]);
    const xml = await footerXmlOf(buffer);
    expect(xml).toContain('<w:tab w:val="right"');
    expect(xml).toContain("<w:instrText xml:space=\"preserve\">PAGE</w:instrText>");
    expect(xml).toContain("<w:instrText xml:space=\"preserve\">NUMPAGES</w:instrText>");
    const rightsIndex = xml.indexOf("All rights reserved");
    const pageFieldIndex = xml.indexOf("PAGE</w:instrText>");
    expect(pageFieldIndex).toBeGreaterThan(rightsIndex);
  });
});

describe("buildStudentGuideDocx front matter", () => {
  it("uses workshopTitle, duration, and learning objectives like IG", async () => {
    const buffer = await buildStudentGuideDocx(
      fakeJob({
        workshopTitle: "AI in Practice",
        duration: "4:00 PM to 6:30 PM",
        learningObjectives: JSON.stringify(["Understand prompting"]),
      }),
      [fakeSlide()]
    );
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("AI in Practice");
    expect(xml).toContain("4:00 PM to 6:30 PM");
    expect(xml).toContain("Understand prompting");
  });

  it("does not render Trainer Guidelines, Material Required, Training Aids, or Training videos", async () => {
    const buffer = await buildStudentGuideDocx(fakeJob(), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    expect(xml).not.toContain("Trainer Guidelines");
    expect(xml).not.toContain("Material Required for the Workshop");
    expect(xml).not.toContain("Training Aids for the Workshop");
    expect(xml).not.toContain("Training videos and important links");
  });

  it("renders a Student Guide heading before the per-slide content", async () => {
    const buffer = await buildStudentGuideDocx(fakeJob(), [fakeSlide()]);
    const xml = await documentXmlOf(buffer);
    const headingIndex = xml.indexOf("Student Guide");
    const slideHeadingIndex = xml.indexOf("Slide 1");
    expect(headingIndex).toBeGreaterThan(-1);
    expect(slideHeadingIndex).toBeGreaterThan(headingIndex);
  });
});

describe("buildStudentGuideDocx per-slide sections", () => {
  it("renders all 4 SG section headings for a teaching slide", async () => {
    const buffer = await buildStudentGuideDocx(fakeJob(), [
      fakeSlide({
        sgSections: JSON.stringify([
          { type: "coreExplanation", title: "Concept Explanation", content: "CAP is about trade-offs." },
          { type: "rememberThis", title: "Remember This", keyPoints: ["Partition tolerance is non-negotiable."] },
          { type: "mentalModel", title: "Mental Model", content: "Think of it like a seesaw." },
          { type: "selfProbingQuestions", title: "Self-Probing Questions", keyPoints: ["Why must you choose?"] },
        ]),
      }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Concept Explanation");
    expect(xml).toContain("CAP is about trade-offs.");
    expect(xml).toContain("Remember This");
    expect(xml).toContain("Partition tolerance is non-negotiable.");
    expect(xml).toContain("Mental Model");
    expect(xml).toContain("Think of it like a seesaw.");
    expect(xml).toContain("Self-Probing Questions");
    expect(xml).toContain("Why must you choose?");
  });

  it("renders only Core Explanation for a non-teaching slide", async () => {
    const buffer = await buildStudentGuideDocx(fakeJob(), [
      fakeSlide({
        sgSections: JSON.stringify([
          { type: "coreExplanation", title: "Concept Explanation", content: "This slide closes the session." },
        ]),
      }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Concept Explanation");
    expect(xml).toContain("This slide closes the session.");
    expect(xml).not.toContain("Remember This");
    expect(xml).not.toContain("Mental Model");
    expect(xml).not.toContain("Self-Probing Questions");
  });

  it("uses the model's Visual Walkthrough title for a visual slide's coreExplanation", async () => {
    const buffer = await buildStudentGuideDocx(fakeJob(), [
      fakeSlide({
        sgSections: JSON.stringify([
          { type: "coreExplanation", title: "Visual Walkthrough", content: "The chart shows adoption by function." },
        ]),
      }),
    ]);
    const xml = await documentXmlOf(buffer);
    expect(xml).toContain("Visual Walkthrough");
    expect(xml).toContain("The chart shows adoption by function.");
  });
});
