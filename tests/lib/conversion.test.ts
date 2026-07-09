import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { convertPptxToSlideImages } from "@/lib/conversion";

const execFileAsync = promisify(execFile);

async function hasSoffice(): Promise<boolean> {
  try {
    await execFileAsync("soffice", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

describe("convertPptxToSlideImages", () => {
  it("converts each slide of the fixture deck to a numbered PNG", async () => {
    if (!(await hasSoffice())) {
      console.warn("Skipping: soffice not installed in this environment");
      return;
    }
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ig-conv-"));
    const fixturePath = path.join(process.cwd(), "tests/fixtures/sample.pptx");

    const count = await convertPptxToSlideImages(fixturePath, tmpDir);

    expect(count).toBe(3);
    for (let i = 1; i <= count; i++) {
      const stat = await fs.stat(path.join(tmpDir, `${i}.png`));
      expect(stat.isFile()).toBe(true);
    }
  });
});
