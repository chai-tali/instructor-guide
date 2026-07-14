import { db } from "@/lib/db";
import { SlideCard } from "@/components/SlideCard";
import { parseGuideTypes } from "@/types/guide";
import type { GuideSection } from "@/types/guide";

export default async function GuidePage({ params }: { params: { jobId: string } }) {
  const job = await db.job.findUniqueOrThrow({ where: { id: params.jobId } });
  const guideTypes = parseGuideTypes(job.guideTypes);

  const slides = await db.slide.findMany({
    where: { jobId: params.jobId },
    orderBy: { index: "asc" },
  });

  return (
    <main>
      <h1>Guide</h1>
      {guideTypes.includes("ig") && (
        <a className="no-print" href={`/api/jobs/${params.jobId}/export`}>
          Export Instructor Guide (.docx)
        </a>
      )}
      {guideTypes.includes("sg") && (
        <a className="no-print" href={`/api/jobs/${params.jobId}/export/sg`}>
          Export Student Guide (.docx)
        </a>
      )}
      {slides.map((slide) => (
        <SlideCard
          key={slide.id}
          id={slide.id}
          index={slide.index}
          imagePath={`/api/slides/${slide.id}/image`}
          status={slide.status}
          sections={slide.sections ? (JSON.parse(slide.sections) as GuideSection[]) : []}
          sgSections={slide.sgSections ? (JSON.parse(slide.sgSections) as GuideSection[]) : []}
          slideTitle={slide.slideTitle}
        />
      ))}
    </main>
  );
}
