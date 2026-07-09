import { prisma } from "@/lib/db";
import { SlideCard } from "@/components/SlideCard";
import type { GuideSection } from "@/types/guide";

export default async function GuidePage({ params }: { params: { jobId: string } }) {
  const slides = await prisma.slide.findMany({
    where: { jobId: params.jobId },
    orderBy: { index: "asc" },
  });

  return (
    <main>
      <h1>Instructor Guide</h1>
      {slides.map((slide) => (
        <SlideCard
          key={slide.id}
          index={slide.index}
          imagePath={`/api/slides/${slide.id}/image`}
          status={slide.status}
          sections={slide.sections ? (JSON.parse(slide.sections) as GuideSection[]) : []}
        />
      ))}
    </main>
  );
}
