import { db } from "@/lib/db";
import { SlideCard } from "@/components/SlideCard";
import type { GuideSection } from "@/types/guide";

export default async function GuidePage({ params }: { params: { jobId: string } }) {
  const slides = await db.slide.findMany({
    where: { jobId: params.jobId },
    orderBy: { index: "asc" },
  });

  return (
    <main>
      <h1>Instructor Guide</h1>
      <a className="no-print" href={`/api/jobs/${params.jobId}/export`}>
        Export Guide (.docx)
      </a>
      {slides.map((slide) => (
        <SlideCard
          key={slide.id}
          id={slide.id}
          index={slide.index}
          imagePath={`/api/slides/${slide.id}/image`}
          status={slide.status}
          sections={slide.sections ? (JSON.parse(slide.sections) as GuideSection[]) : []}
        />
      ))}
    </main>
  );
}
