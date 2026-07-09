import type { GuideSection } from "@/types/guide";

const SECTION_TITLES: Record<string, string> = {
  trainerPointer: "Trainer Pointer",
  whyItMatters: "Why It Matters",
  mentalModel: "Mental Model",
  bestPractices: "Best Practices",
  commonPitfalls: "Common Pitfalls",
  realWorldImplementation: "Real World Implementation",
  howThisFits: "How This Fits",
  faq: "FAQ",
  interviewQuestions: "Interview Questions",
};

export function SlideCard({
  index,
  imagePath,
  status,
  sections,
}: {
  index: number;
  imagePath: string;
  status: string;
  sections: GuideSection[];
}) {
  return (
    <section>
      <h2>Slide {index + 1}</h2>
      <img src={imagePath} alt={`Slide ${index + 1}`} width={480} />
      {status === "failed" && <p role="alert">This slide failed to generate.</p>}
      {sections.map((section) => (
        <div key={section.type}>
          <h3>{section.title || SECTION_TITLES[section.type] || section.type}</h3>
          {section.content && <p>{section.content}</p>}
          {section.items && (
            <ul>
              {section.items.map((item, i) => (
                <li key={i}>
                  {item.question !== "bullet" && <strong>{item.question}: </strong>}
                  {item.answer}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
