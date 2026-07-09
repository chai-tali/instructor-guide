"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface JobStatus {
  status: string;
  totalSlides: number | null;
  completedSlides: number;
  error: string | null;
}

export function JobProgress({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const res = await fetch(`/api/jobs/${jobId}`);
      const data: JobStatus = await res.json();
      if (cancelled) return;

      setJob(data);
      if (data.status === "done") {
        router.push(`/guide/${jobId}`);
        return;
      }
      if (data.status !== "failed") {
        setTimeout(poll, 2000);
      }
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [jobId, router]);

  if (!job) return <p>Loading...</p>;
  if (job.status === "failed") return <p role="alert">Processing failed: {job.error}</p>;

  return (
    <p>
      Processing slide {job.completedSlides} of {job.totalSlides ?? "…"}
    </p>
  );
}
