import { describe, it, expect } from "vitest";
import {
  TRAINER_GUIDELINES_DOS,
  TRAINER_GUIDELINES_DONTS,
  MATERIAL_REQUIRED_ITEMS,
  TRAINING_AIDS_ITEMS,
  TRAINING_VIDEO_ITEMS,
} from "@/lib/static-guide-content";

describe("static-guide-content", () => {
  it("exposes non-empty static lists for every front-matter section", () => {
    expect(TRAINER_GUIDELINES_DOS.length).toBeGreaterThan(0);
    expect(TRAINER_GUIDELINES_DONTS.length).toBeGreaterThan(0);
    expect(MATERIAL_REQUIRED_ITEMS.length).toBeGreaterThan(0);
    expect(TRAINING_AIDS_ITEMS.length).toBeGreaterThan(0);
    expect(TRAINING_VIDEO_ITEMS.length).toBeGreaterThan(0);
  });

  it("keeps Trainer Guidelines Do's at least as long as Don'ts, matching the reference table", () => {
    expect(TRAINER_GUIDELINES_DOS.length).toBeGreaterThanOrEqual(TRAINER_GUIDELINES_DONTS.length);
  });

  it("leaves Training Aids items blank after the colon for manual fill-in", () => {
    for (const item of TRAINING_AIDS_ITEMS) {
      expect(item.trim().endsWith(":")).toBe(true);
    }
  });
});
