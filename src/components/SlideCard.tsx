import ReactMarkdown from "react-markdown";
import type { GuideSection } from "@/types/guide";
import { sectionDisplayTitle, sgSectionDisplayTitle } from "@/types/guide";
import { RetrySlideButton } from "@/components/RetrySlideButton";

function SectionList({
  sections,
  titleFor,
}: {
  sections: GuideSection[];
  titleFor: (section: GuideSection) => string;
}) {
  return (
    <>
      {sections.map((section, i) => (
        <div key={`${section.type}-${i}`}>
          <h3>{titleFor(section)}</h3>
          {section.content && <ReactMarkdown>{section.content}</ReactMarkdown>}
          {section.items && (
            <ul>
              {section.items.map((item, j) => (
                <li key={j}>
                  {item.question !== "bullet" && <strong>{item.question}: </strong>}
                  <ReactMarkdown>{item.answer}</ReactMarkdown>
                </li>
              ))}
            </ul>
          )}
          {section.keyPoints && section.keyPoints.length > 0 && (
            <>
              {section.type === "trainerPointer" && <h4>Key Points</h4>}
              <ul>
                {section.keyPoints.map((point, j) => (
                  <li key={j}>{point}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ))}
    </>
  );
}

export function SlideCard({
  id,
  index,
  imagePath,
  status,
  sections,
  sgSections,
  slideTitle,
}: {
  id: string;
  index: number;
  imagePath: string;
  status: string;
  sections: GuideSection[];
  sgSections?: GuideSection[];
  slideTitle?: string | null;
}) {
  return (
    <section>
      <h2>Slide {index + 1}{slideTitle ? `: ${slideTitle}` : ""}</h2>
      <img src={imagePath} alt={`Slide ${index + 1}`} width={480} />
      {status === "failed" && (
        <>
          <p role="alert">This slide failed to generate.</p>
          <div className="no-print">
            <RetrySlideButton slideId={id} />
          </div>
        </>
      )}
      {sections.length > 0 && (
        <>
          <h3>Instructor Guide</h3>
          <SectionList sections={sections} titleFor={sectionDisplayTitle} />
        </>
      )}
      {sgSections && sgSections.length > 0 && (
        <>
          <h3>Student Guide</h3>
          <SectionList sections={sgSections} titleFor={sgSectionDisplayTitle} />
        </>
      )}
    </section>
  );
}
