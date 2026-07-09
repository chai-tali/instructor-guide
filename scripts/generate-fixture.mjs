import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// pptxgenjs's ESM build ("exports"."import") lacks "type": "module" in its own
// package.json, which makes Node's loader choke on the `import` syntax inside
// dist/pptxgen.es.js when this project itself isn't type:module. Requiring the
// CJS build directly sidesteps that packaging issue.
const pptxgen = require("pptxgenjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pres = new pptxgen();

const slide1 = pres.addSlide();
slide1.addText("Welcome to the Course", { x: 1, y: 1, fontSize: 32 });

const slide2 = pres.addSlide();
slide2.addText("Agenda", { x: 1, y: 0.5, fontSize: 28 });
slide2.addText("1. Introduction\n2. Core Concepts\n3. Wrap Up", {
  x: 1,
  y: 1.5,
  fontSize: 18,
});

const slide3 = pres.addSlide();
slide3.addText("Thank You", { x: 1, y: 1, fontSize: 32 });

await pres.writeFile({
  fileName: path.join(__dirname, "../tests/fixtures/sample.pptx"),
});
console.log("Fixture written to tests/fixtures/sample.pptx");
