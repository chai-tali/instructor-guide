import { UploadForm } from "@/components/UploadForm";

export default function HomePage() {
  return (
    <main>
      <h1>Instructor Guide Generator</h1>
      <p>Upload a .pptx deck to generate a per-slide instructor guide.</p>
      <UploadForm />
    </main>
  );
}
