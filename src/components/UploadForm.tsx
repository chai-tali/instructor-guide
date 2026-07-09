"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function UploadForm() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) {
      setError("Please choose a .pptx file");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    setUploading(false);

    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Upload failed");
      return;
    }

    const { jobId } = await res.json();
    router.push(`/jobs/${jobId}`);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="file" name="file" accept=".pptx" />
      <button type="submit" disabled={uploading}>
        {uploading ? "Uploading..." : "Upload"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
