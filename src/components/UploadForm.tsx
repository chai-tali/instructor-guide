"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function UploadForm() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wantsIG, setWantsIG] = useState(true);
  const [wantsSG, setWantsSG] = useState(false);
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
    if (!wantsIG && !wantsSG) {
      setError("Select at least one guide type");
      return;
    }

    const guideTypes: string[] = [];
    if (wantsIG) guideTypes.push("ig");
    if (wantsSG) guideTypes.push("sg");

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("guideTypes", JSON.stringify(guideTypes));

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
      <label>
        <input type="checkbox" checked={wantsIG} onChange={(e) => setWantsIG(e.target.checked)} />
        Instructor Guide
      </label>
      <label>
        <input type="checkbox" checked={wantsSG} onChange={(e) => setWantsSG(e.target.checked)} />
        Student Guide
      </label>
      <button type="submit" disabled={uploading}>
        {uploading ? "Uploading..." : "Upload"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
