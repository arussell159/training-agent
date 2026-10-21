// Explicit capture-region extraction only. Never a substitute for comparing placement.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadPng } from "./trainingpeaks-visual-compare.mjs";
const require = createRequire(import.meta.url);
export function loadSharp() {
  try {
    return require("sharp");
  } catch {
    return require(
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"
      )
    );
  }
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pathKey = (name) =>
  process.platform === "win32" ? path.resolve(name).toLowerCase() : path.resolve(name);

export async function cropEvidence(input, output, rectangle) {
  const sourcePath = path.resolve(input);
  const outputPath = path.resolve(output);
  const metadataPath = `${outputPath}.capture.json`;
  if ([outputPath, metadataPath].some((name) => pathKey(name) === pathKey(sourcePath)))
    throw new Error("Crop output must not overwrite its source.");
  const bytes = await fs.readFile(sourcePath);
  const PNG = loadPng();
  const sourceEncoding = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "PNG"
    : bytes[0] === 255 && bytes[1] === 216
      ? "JPEG"
      : null;
  if (!sourceEncoding) throw new Error("Crop source must be PNG or JPEG.");
  let source;
  if (sourceEncoding === "PNG") source = PNG.sync.read(bytes);
  else {
    const decoded = await loadSharp()(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    source = { width: decoded.info.width, height: decoded.info.height, data: decoded.data };
  }
  let previousCapture = null;
  try {
    previousCapture = JSON.parse(await fs.readFile(`${sourcePath}.capture.json`, "utf8"));
    if (previousCapture.outputSha256 !== sha256(bytes))
      throw new Error("Source capture sidecar hash does not match its image.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const jpegDerived = sourceEncoding === "JPEG" || previousCapture?.jpegDerived === true;
  const { x, y, width, height } = rectangle;
  if (
    ![x, y, width, height].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > source.width ||
    y + height > source.height
  )
    throw new Error("Crop must be an integer rectangle fully inside the original screenshot.");
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row += 1)
    source.data.copy(
      data,
      row * width * 4,
      ((y + row) * source.width + x) * 4,
      ((y + row) * source.width + x + width) * 4
    );
  const cropped = PNG.sync.write({ width, height, data });
  const metadata = {
    version: 1,
    operation: "explicit-crop-no-rescaling",
    generatedAt: new Date().toISOString(),
    sourcePath,
    sourceSha256: sha256(bytes),
    sourceEncoding,
    jpegDerived,
    acceptanceEligible: !jpegDerived,
    previousCapture,
    sourceSize: { width: source.width, height: source.height },
    sourceRectangle: rectangle,
    outputPath,
    outputSha256: sha256(cropped),
    placementVerified: false,
    limitation:
      "Comparing independently cropped components can conceal positional differences. Preserve this metadata and compare sourceRectangle positions plus the complete scoped surfaces separately; a crop pixel pass does not establish placement parity.",
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, cropped);
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
  return metadata;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 8)
      throw new Error(
        "Usage: node tools/trainingpeaks-image-crop.mjs <source.png|source.jpg> <crop.png> <x> <y> <width> <height>"
      );
    const [x, y, width, height] = process.argv.slice(4).map(Number);
    const metadata = await cropEvidence(process.argv[2], process.argv[3], { x, y, width, height });
    console.log(JSON.stringify(metadata));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
