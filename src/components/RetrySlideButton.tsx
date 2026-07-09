"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RetrySlideButton({ slideId }: { slideId: string }) {
  const [retrying, setRetrying] = useState(false);
  const router = useRouter();

  async function handleRetry() {
    setRetrying(true);
    await fetch(`/api/slides/${slideId}/retry`, { method: "POST" });
    setRetrying(false);
    router.refresh();
  }

  return (
    <button onClick={handleRetry} disabled={retrying}>
      {retrying ? "Retrying..." : "Retry this slide"}
    </button>
  );
}
