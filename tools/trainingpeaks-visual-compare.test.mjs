import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { comparePixels, loadPng, runComparison } from "./trainingpeaks-visual-compare.mjs";
import { cropEvidence, loadSharp } from "./trainingpeaks-image-crop.mjs";

const image = (width = 100, height = 100) => ({
  width,
  height,
  data: Buffer.alloc(width * height * 4, 255),
});
const full = { x: 0, y: 0, width: 100, height: 100 };

test("identical pixels have zero difference and unchanged crop bytes", () => {
  const a = image();
  const result = comparePixels(a, a, full);
  assert.equal(result.changedPixels, 0);
  assert.equal(result.meanAbsoluteChannelError, 0);
  assert.deepEqual(result.crops.reference, a.data);
});

test("every RGBA channel contributes to changed pixels including alpha", () => {
  const a = image();
  const b = image();
  b.data[0] = 0;
  b.data[7] = 254;
  const result = comparePixels(a, b, full);
  assert.equal(result.changedPixels, 2);
  assert.equal(result.changedPixelRatio, 0.0002);
  assert.equal(result.maxChannelDifference, 255);
  assert.equal(result.meanAbsoluteChannelError, 256 / 40000);
  assert.deepEqual([...result.crops.diff.subarray(0, 4)], [255, 0, 80, 255]);
});

test("documented channel tolerance applies per pixel and does not alter raw error", () => {
  const a = image();
  const b = image();
  b.data[0] = 253;
  b.data[4] = 252;
  const result = comparePixels(a, b, full, 2);
  assert.equal(result.changedPixels, 1);
  assert.equal(result.maxChannelDifference, 3);
  assert.equal(result.meanAbsoluteChannelError, 5 / 40000);
  assert.throws(() => comparePixels(a, b, full, 9), /channelTolerance/);
});

test("invalid bounds and dimension mismatch cannot be resized or hidden", () => {
  assert.throws(() => comparePixels(image(), image(99, 100), full), /dimensions differ/);
  for (const crop of [
    { ...full, x: -1 },
    { ...full, width: 101 },
    { ...full, height: 0 },
    { ...full, x: 0.5 },
  ]) {
    assert.throws(() => comparePixels(image(), image(), crop), /Region/);
  }
});

async function fixture(t, mutate = () => {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tp-visual-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const PNG = loadPng();
  const a = image();
  const b = image();
  mutate(b);
  await fs.writeFile(path.join(dir, "reference.png"), PNG.sync.write(a));
  await fs.writeFile(path.join(dir, "actual.png"), PNG.sync.write(b));
  const manifest = {
    version: 1,
    conditions: {
      syntheticHarnessVerification: true,
      viewport: "100x100",
      data: "generated white squares; not TrainingPeaks evidence",
    },
    pairs: [
      {
        id: "synthetic",
        reference: "reference.png",
        actual: "actual.png",
        provenance: "Independent synthetic PNGs for harness regression only; no parity claim.",
        matchingInputs: "100x100 RGBA white squares with deliberate pixel mutations.",
        regions: [{ id: "button", x: 0, y: 0, width: 10, height: 10 }],
      },
    ],
  };
  const manifestPath = path.join(dir, "manifest.json");
  async function run() {
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    return runComparison(manifestPath, path.join(dir, "evidence"));
  }
  return { dir, manifest, run };
}

test("a component fails even when a blank full page hides its differences", async (t) => {
  const { run } = await fixture(t, (b) => {
    b.data[0] = 0;
    b.data[4] = 0;
  });
  const { report, output } = await run();
  assert.equal(report.pairs[0].regions[0].passed, true);
  assert.equal(report.pairs[0].regions[1].changedPixelRatio, 0.02);
  assert.equal(report.pairs[0].regions[1].passed, false);
  assert.equal(report.passed, false);
  assert.equal(
    (await fs.readFile(path.join(output, "report.html"), "utf8")).includes("2.0000%"),
    true
  );
  const PNG = loadPng();
  const diff = PNG.sync.read(await fs.readFile(path.join(output, "synthetic/button-diff.png")));
  assert.equal(diff.width, 10);
  assert.deepEqual([...diff.data.subarray(0, 4)], [255, 0, 80, 255]);
  assert.match(report.pairs[0].referenceSha256, /^[0-9a-f]{64}$/);
});

test("exactly 1% passes both the full image and component boundary", async (t) => {
  const { run } = await fixture(t, (b) => {
    b.data[0] = 0;
  });
  const { report } = await run();
  assert.equal(report.pairs[0].regions[1].changedPixelRatio, 0.01);
  assert.equal(report.passed, true);
});

test("missing screenshots and dimension mismatches are failures with evidence", async (t) => {
  const f = await fixture(t);
  f.manifest.pairs[0].actual = "missing.png";
  const missing = await f.run();
  assert.equal(missing.report.passed, false);
  assert.match(missing.report.pairs[0].error, /ENOENT/);
  f.manifest.pairs[0].actual = "actual.png";
  await fs.writeFile(path.join(f.dir, "actual.png"), loadPng().sync.write(image(99, 100)));
  const mismatch = await f.run();
  assert.equal(mismatch.report.passed, false);
  assert.match(mismatch.report.pairs[0].error, /dimensions differ/);
});

test("1% limit cannot be inflated and nonzero tolerance needs justification", async (t) => {
  const f = await fixture(t);
  f.manifest.maxDiffPixelRatio = 0.02;
  await assert.rejects(f.run, /1% gate cannot be relaxed/);
  f.manifest.maxDiffPixelRatio = 0.01;
  f.manifest.channelTolerance = 1;
  await assert.rejects(f.run, /noiseJustification/);
});

test("missing component/provenance is an open failure rather than a passing state", async (t) => {
  const f = await fixture(t);
  f.manifest.pairs[0].regions = [];
  assert.match((await f.run()).report.pairs[0].error, /component crop/);
  f.manifest.pairs[0].provenance = "";
  assert.match((await f.run()).report.pairs[0].error, /source of the reference/);
});

test("accidental self-comparison and output-over-input cannot replace a reference", async (t) => {
  const f = await fixture(t);
  f.manifest.pairs[0].actual = "reference.png";
  await assert.rejects(f.run, /separate files/);
  const relative = "evidence/synthetic/full-reference.png";
  const referencePath = path.join(f.dir, relative);
  await fs.mkdir(path.dirname(referencePath), { recursive: true });
  const original = await fs.readFile(path.join(f.dir, "reference.png"));
  await fs.writeFile(referencePath, original);
  f.manifest.pairs[0].actual = "actual.png";
  f.manifest.pairs[0].reference = relative;
  const { report } = await f.run();
  assert.equal(report.passed, false);
  assert.match(report.pairs[0].error, /overwrite an input/);
  assert.deepEqual(await fs.readFile(referencePath), original);
});

test("explicit crops preserve source coordinates, exact pixels and immutable source evidence", async (t) => {
  const f = await fixture(t, (b) => {
    b.data[(5 * b.width + 4) * 4] = 10;
  });
  const source = path.join(f.dir, "actual.png");
  const original = await fs.readFile(source);
  const destination = path.join(f.dir, "cropped.png");
  const rectangle = { x: 4, y: 5, width: 7, height: 8 };
  const meta = await cropEvidence(source, destination, rectangle);
  assert.deepEqual(meta.sourceRectangle, rectangle);
  assert.deepEqual(meta.sourceSize, { width: 100, height: 100 });
  assert.equal(meta.placementVerified, false);
  const crop = loadPng().sync.read(await fs.readFile(destination));
  assert.equal(crop.data[0], 10);
  assert.deepEqual([crop.width, crop.height], [7, 8]);
  assert.deepEqual(await fs.readFile(source), original);
  assert.deepEqual(
    JSON.parse(await fs.readFile(`${destination}.capture.json`, "utf8")).sourceRectangle,
    rectangle
  );
  await assert.rejects(() => cropEvidence(source, source, rectangle), /overwrite/);
  await assert.rejects(
    () => cropEvidence(source, destination, { ...rectangle, width: 101 }),
    /fully inside/
  );
});

test("diagnostic manifests cannot pass acceptance even when all measured pixels match", async (t) => {
  const f = await fixture(t);
  f.manifest.conditions.acceptanceEligible = false;
  const { report, output } = await f.run();
  assert.equal(report.pixelsPassed, true);
  assert.equal(report.acceptanceEligible, false);
  assert.equal(report.passed, false);
  assert.match(await fs.readFile(path.join(output, "report.html"), "utf8"), /DIAGNOSTIC ONLY/);
});

test("JPEG decoding preserves lossy provenance and cannot become acceptance-eligible PNG", async (t) => {
  const f = await fixture(t);
  const jpeg = await loadSharp()(await fs.readFile(path.join(f.dir, "reference.png")))
    .jpeg()
    .toBuffer();
  const jpegPath = path.join(f.dir, "lossy.jpg");
  await fs.writeFile(jpegPath, jpeg);
  for (const name of ["reference.png", "actual.png"]) {
    const meta = await cropEvidence(jpegPath, path.join(f.dir, name), full);
    assert.equal(meta.sourceEncoding, "JPEG");
    assert.equal(meta.jpegDerived, true);
    assert.equal(meta.acceptanceEligible, false);
  }
  const { report } = await f.run();
  assert.equal(report.pixelsPassed, true);
  assert.equal(report.acceptanceEligible, false);
  assert.equal(report.passed, false);
  assert.deepEqual(report.pairs[0].sourceGeometryDifference, { x: 0, y: 0, width: 0, height: 0 });
  const further = await cropEvidence(
    path.join(f.dir, "reference.png"),
    path.join(f.dir, "further.png"),
    { x: 1, y: 1, width: 5, height: 5 }
  );
  assert.equal(further.sourceEncoding, "PNG");
  assert.equal(further.jpegDerived, true);
  assert.equal(further.acceptanceEligible, false);
  await fs.writeFile(path.join(f.dir, "reference.png"), jpeg);
  await fs.rm(path.join(f.dir, "reference.png.capture.json"));
  const renamed = await f.run();
  assert.equal(renamed.report.passed, false);
  assert.match(renamed.report.pairs[0].error, /must be PNG/);
});
