import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export async function convertPptxToSlideImages(
  pptxPath: string,
  outputDir: string
): Promise<number> {
  await fs.mkdir(outputDir, { recursive: true });

  await execFileAsync(
    "soffice",
    ["--headless", "--convert-to", "pdf", "--outdir", outputDir, pptxPath],
    { timeout: 120_000 }
  );

  const pptxBasename = path.basename(pptxPath, path.extname(pptxPath));
  const pdfPath = path.join(outputDir, `${pptxBasename}.pdf`);

  await execFileAsync(
    "pdftoppm",
    ["-png", "-r", "150", pdfPath, path.join(outputDir, "slide")],
    { timeout: 120_000 }
  );

  const files = (await fs.readdir(outputDir)).filter(
    (f) => f.startsWith("slide") && f.endsWith(".png")
  );
  files.sort((a, b) => {
    const na = parseInt(a.match(/(\d+)/)?.[1] ?? "0", 10);
    const nb = parseInt(b.match(/(\d+)/)?.[1] ?? "0", 10);
    return na - nb;
  });

  await Promise.all(
    files.map((file, i) =>
      fs.rename(path.join(outputDir, file), path.join(outputDir, `${i + 1}.png`))
    )
  );

  await fs.rm(pdfPath, { force: true });

  return files.length;
}
