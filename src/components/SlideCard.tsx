import ReactMarkdown from "react-markdown";
import type { GuideSection } from "@/types/guide";
import { SECTION_TITLES } from "@/types/guide";
import { RetrySlideButton } from "@/components/RetrySlideButton";

export function SlideCard({
  id,
  index,
  imagePath,
  status,
  sections,
}: {
  id: string;
  index: number;
  imagePath: string;
  status: string;
  sections: GuideSection[];
}) {
  return (
    <section>
      <h2>Slide {index + 1}</h2>
      <img src={imagePath} alt={`Slide ${index + 1}`} width={480} />
      {status === "failed" && (
        <>
          <p role="alert">This slide failed to generate.</p>
          <div className="no-print">
            <RetrySlideButton slideId={id} />
          </div>
        </>
      )}
      {sections.map((section) => (
        <div key={section.type}>
          <h3>{section.title || SECTION_TITLES[section.type] || section.type}</h3>
          {section.content && <ReactMarkdown>{section.content}</ReactMarkdown>}
          {section.items && (
            <ul>
              {section.items.map((item, i) => (
                <li key={i}>
                  {item.question !== "bullet" && <strong>{item.question}: </strong>}
                  <ReactMarkdown>{item.answer}</ReactMarkdown>
                </li>
              ))}
            </ul>
          )}
          {section.keyPoints && section.keyPoints.length > 0 && (
            <>
              <h4>Key Points</h4>
              <ul>
                {section.keyPoints.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
