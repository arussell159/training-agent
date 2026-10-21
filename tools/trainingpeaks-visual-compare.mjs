// Compare captured evidence; this tool never captures or changes a reference.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export function loadPng() {
  try {
    return require("pngjs").PNG;
  } catch {
    try {
      return require(
        path.join(
          os.homedir(),
          ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs"
        )
      ).PNG;
    } catch {
      throw new Error(
        "PNG decoder unavailable. Install pngjs as a development dependency, or use the bundled Codex runtime."
      );
    }
  }
}
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const slug = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
const pathKey = (value) =>
  process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function comparePixels(reference, actual, region, channelTolerance = 0) {
  check(
    reference.width === actual.width && reference.height === actual.height,
    "Screenshot dimensions differ; resizing is prohibited."
  );
  check(
    Number.isInteger(channelTolerance) && channelTolerance >= 0 && channelTolerance <= 8,
    "channelTolerance must be an integer from 0 through 8."
  );
  const { x, y, width, height } = region;
  check(
    [x, y, width, height].every(Number.isInteger) &&
      x >= 0 &&
      y >= 0 &&
      width > 0 &&
      height > 0 &&
      x + width <= reference.width &&
      y + height <= reference.height,
    "Region must be an integer rectangle wholly inside both screenshots."
  );
  const pixels = width * height;
  const crops = Object.fromEntries(
    ["reference", "actual", "diff", "overlay"].map((name) => [name, Buffer.alloc(pixels * 4)])
  );
  let changedPixels = 0;
  let absoluteError = 0;
  let maxChannelDifference = 0;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const source = ((y + row) * reference.width + x + col) * 4;
      const dest = (row * width + col) * 4;
      let changed = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const a = reference.data[source + channel];
        const b = actual.data[source + channel];
        const delta = Math.abs(a - b);
        if (delta > channelTolerance) changed = true;
        absoluteError += delta;
        maxChannelDifference = Math.max(maxChannelDifference, delta);
        crops.reference[dest + channel] = a;
        crops.actual[dest + channel] = b;
        crops.overlay[dest + channel] = Math.round((a + b) / 2);
      }
      if (changed) changedPixels += 1;
      const gray = Math.round(
        ((reference.data[source] + reference.data[source + 1] + reference.data[source + 2]) / 3) *
          0.25
      );
      crops.diff.set(changed ? [255, 0, 80, 255] : [gray, gray, gray, 255], dest);
    }
  }
  return {
    width,
    height,
    pixels,
    changedPixels,
    changedPixelRatio: changedPixels / pixels,
    meanAbsoluteChannelError: absoluteError / (pixels * 4),
    maxChannelDifference,
    crops,
  };
}

export async function runComparison(manifestPath, outputPath) {
  const PNG = loadPng();
  const sourcePath = path.resolve(manifestPath);
  const manifestBytes = await fs.readFile(sourcePath);
  const manifest = JSON.parse(manifestBytes);
  check(manifest.version === 1, "Manifest version must be 1.");
  check(
    Array.isArray(manifest.pairs) && manifest.pairs.length > 0,
    "At least one evidence pair is required."
  );
  const maximum = manifest.maxDiffPixelRatio ?? 0.01;
  const tolerance = manifest.channelTolerance ?? 0;
  check(
    Number.isFinite(maximum) && maximum >= 0 && maximum <= 0.01,
    "maxDiffPixelRatio must be between 0 and 0.01; the 1% gate cannot be relaxed."
  );
  check(
    Number.isInteger(tolerance) && tolerance >= 0 && tolerance <= 8,
    "channelTolerance must be an integer from 0 through 8."
  );
  check(
    tolerance === 0 ||
      (typeof manifest.noiseJustification === "string" &&
        manifest.noiseJustification.trim().length > 0),
    "Nonzero channel tolerance requires a noiseJustification."
  );
  check(
    manifest.conditions &&
      typeof manifest.conditions === "object" &&
      !Array.isArray(manifest.conditions),
    "Document the shared capture conditions in conditions."
  );
  const output = path.resolve(outputPath ?? manifest.output ?? "artifacts/trainingpeaks-visual");
  const directory = path.dirname(sourcePath);
  const ids = new Set();
  const inputs = new Set([pathKey(sourcePath)]);
  for (const pair of manifest.pairs) {
    check(
      typeof pair.id === "string" && /^[a-zA-Z0-9_-]+$/.test(pair.id) && !ids.has(pair.id),
      "Each pair needs a unique filesystem-safe id."
    );
    ids.add(pair.id);
    check(
      typeof pair.reference === "string" && typeof pair.actual === "string",
      `${pair.id}: reference and actual paths are required.`
    );
    check(
      pathKey(path.resolve(directory, pair.reference)) !==
        pathKey(path.resolve(directory, pair.actual)),
      `${pair.id}: reference and actual must be separate files.`
    );
    inputs.add(pathKey(path.resolve(directory, pair.reference)));
    inputs.add(pathKey(path.resolve(directory, pair.actual)));
  }
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    manifestPath: sourcePath,
    manifestSha256: hash(manifestBytes),
    metric:
      "Fraction of pixels whose maximum RGBA channel difference exceeds channelTolerance; no rescaling, alignment correction, masks, or antialias exclusions.",
    maxDiffPixelRatio: maximum,
    channelTolerance: tolerance,
    noiseJustification: manifest.noiseJustification ?? null,
    conditions: manifest.conditions,
    acceptanceEligible: manifest.conditions.acceptanceEligible !== false,
    ineligibilityReasons:
      manifest.conditions.acceptanceEligible === false
        ? ["Manifest explicitly marks this comparison as diagnostic and ineligible for acceptance."]
        : [],
    pairs: [],
    passed: false,
    limitation:
      "Capture conditions, reference provenance and matching inputs require separate evidence. A pixel pass does not establish functional or numerical parity.",
  };
  async function write(relative, bytes) {
    const destination = path.resolve(output, relative);
    check(
      !inputs.has(pathKey(destination)),
      "Output would overwrite an input; choose a separate evidence directory."
    );
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
  }
  for (const pair of manifest.pairs) {
    const result = {
      id: pair.id,
      matchingInputs: pair.matchingInputs ?? null,
      provenance: pair.provenance ?? null,
      reference: path.resolve(directory, pair.reference),
      actual: path.resolve(directory, pair.actual),
      regions: [],
      passed: false,
    };
    report.pairs.push(result);
    try {
      check(
        typeof pair.matchingInputs === "string" && pair.matchingInputs.trim(),
        "Describe equivalent reference/local data and interaction state in matchingInputs."
      );
      check(
        typeof pair.provenance === "string" && pair.provenance.trim(),
        "Document the source of the reference in provenance."
      );
      check(
        Array.isArray(pair.regions) && pair.regions.length > 0,
        "At least one key component crop is required in addition to the full screenshot."
      );
      const [referenceBytes, actualBytes] = await Promise.all([
        fs.readFile(result.reference),
        fs.readFile(result.actual),
      ]);
      result.referenceSha256 = hash(referenceBytes);
      result.actualSha256 = hash(actualBytes);
      result.captureMetadata = {};
      result.acceptanceEligible = true;
      for (const [kind, filename, bytes] of [
        ["reference", result.reference, referenceBytes],
        ["actual", result.actual, actualBytes],
      ]) {
        try {
          const capture = JSON.parse(await fs.readFile(`${filename}.capture.json`, "utf8"));
          check(
            capture.outputSha256 === hash(bytes),
            `${kind}: capture sidecar hash does not match its image.`
          );
          result.captureMetadata[kind] = capture;
          if (capture.jpegDerived === true || capture.acceptanceEligible === false) {
            result.acceptanceEligible = false;
            report.acceptanceEligible = false;
            report.ineligibilityReasons.push(
              `${pair.id} ${kind}: JPEG-derived or otherwise ineligible capture; decoding to PNG cannot restore lossless pixels.`
            );
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      const referenceBounds = result.captureMetadata.reference?.sourceRectangle;
      const actualBounds = result.captureMetadata.actual?.sourceRectangle;
      if (referenceBounds && actualBounds)
        result.sourceGeometryDifference = Object.fromEntries(
          ["x", "y", "width", "height"].map((key) => [
            key,
            actualBounds[key] - referenceBounds[key],
          ])
        );
      for (const bytes of [referenceBytes, actualBytes]) {
        check(
          bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
          "Both inputs must be PNG files."
        );
        check(
          bytes.length >= 24 && bytes.readUInt32BE(16) * bytes.readUInt32BE(20) <= 40_000_000,
          "Screenshot exceeds the 40 million pixel safety limit."
        );
      }
      const reference = PNG.sync.read(referenceBytes);
      const actual = PNG.sync.read(actualBytes);
      result.referenceSize = { width: reference.width, height: reference.height };
      result.actualSize = { width: actual.width, height: actual.height };
      check(
        reference.width === actual.width && reference.height === actual.height,
        "Screenshot dimensions differ; resizing is prohibited."
      );
      const regions = [
        { id: "full", x: 0, y: 0, width: reference.width, height: reference.height },
        ...pair.regions,
      ];
      const regionIds = new Set();
      for (const region of regions) {
        check(
          typeof region.id === "string" &&
            region.id === slug(region.id) &&
            region.id &&
            !regionIds.has(region.id),
          "Region IDs must be unique and filesystem-safe; full is reserved."
        );
        regionIds.add(region.id);
        const { crops, ...measurement } = comparePixels(reference, actual, region, tolerance);
        const files = {};
        for (const [name, data] of Object.entries(crops)) {
          const file = `${pair.id}/${region.id}-${name}.png`;
          await write(file, PNG.sync.write({ width: region.width, height: region.height, data }));
          files[name] = file;
        }
        result.regions.push({
          id: region.id,
          rectangle: { x: region.x, y: region.y, width: region.width, height: region.height },
          ...measurement,
          passed: measurement.changedPixelRatio <= maximum,
          files,
        });
      }
      result.passed = result.regions.every((region) => region.passed);
    } catch (error) {
      result.error = error.message;
    }
  }
  report.pixelsPassed = report.pairs.every((pair) => pair.passed);
  report.passed = report.pixelsPassed && report.acceptanceEligible;
  await write("results.json", JSON.stringify(report, null, 2) + "\n");
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
    );
  const rows = report.pairs
    .map(
      (pair) =>
        `<section><h2>${escape(pair.id)} — PIXELS ${pair.passed ? "PASS" : "FAIL"}</h2>${pair.acceptanceEligible === false ? "<p>DIAGNOSTIC ONLY: capture is not eligible for acceptance.</p>" : ""}${pair.sourceGeometryDifference ? `<p>Original source geometry delta (actual minus reference; crop normalization does not establish placement):</p><pre>${escape(JSON.stringify(pair.sourceGeometryDifference))}</pre>` : ""}${pair.error ? `<p>${escape(pair.error)}</p>` : ""}${pair.regions
          .map(
            (region) =>
              `<h3>${escape(region.id)}: ${(100 * region.changedPixelRatio).toFixed(4)}% changed (${region.changedPixels}/${region.pixels}) — ${region.passed ? "PASS" : "FAIL"}</h3><div>${Object.entries(
                region.files
              )
                .map(
                  ([name, file]) =>
                    `<figure><figcaption>${name}</figcaption><a href="${file}"><img src="${file}" alt="${escape(pair.id)} ${escape(region.id)} ${name}"></a></figure>`
                )
                .join("")}</div>`
          )
          .join("")}</section>`
    )
    .join("");
  await write(
    "report.html",
    `<!doctype html><meta charset="utf-8"><title>TrainingPeaks captured-image comparison</title><style>body{font:16px system-ui;margin:24px;background:#eee;color:#111}div{display:flex;gap:12px;flex-wrap:wrap}figure{margin:0;max-width:46%}img{max-width:100%;height:auto}section{background:white;padding:16px;margin:16px 0}pre{white-space:pre-wrap}</style><h1>${!report.acceptanceEligible ? "DIAGNOSTIC ONLY — NOT ELIGIBLE FOR ACCEPTANCE" : report.passed ? "PASS" : "FAIL"}: captured-image comparison</h1><p>${escape(report.ineligibilityReasons.join(" "))}</p><p>Limit ${(maximum * 100).toFixed(2)}% per full image and per component; channel tolerance ${tolerance}/255. Pink identifies changed pixels. Overlay is a 50/50 blend. Click images to inspect native resolution.</p><p>${escape(report.limitation)}</p><pre>${escape(JSON.stringify(report.conditions, null, 2))}</pre>${rows}<p><a href="results.json">Machine-readable measurements and SHA-256 provenance</a></p>`
  );
  return { report, output };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check(
      process.argv[2] && !process.argv[2].startsWith("--"),
      "Usage: node tools/trainingpeaks-visual-compare.mjs <manifest.json> [output-directory]"
    );
    const { report, output } = await runComparison(process.argv[2], process.argv[3]);
    console.log(
      JSON.stringify({
        passed: report.passed,
        pairs: report.pairs.length,
        report: path.join(output, "report.html"),
      })
    );
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
