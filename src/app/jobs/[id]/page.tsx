import { JobProgress } from "@/components/JobProgress";

export default function JobStatusPage({ params }: { params: { id: string } }) {
  return <JobProgress jobId={params.id} />;
}
