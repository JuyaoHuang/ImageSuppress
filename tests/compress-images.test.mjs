import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { compressDirectory, parseCliArgs } from '../src/mozjpeg-batch.mjs';

globalThis.ImageData = class ImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
};

const require = createRequire(import.meta.url);
globalThis.require = require;

async function loadMozjpegDecoder() {
  const decDir = path.resolve('squoosh/codecs/mozjpeg/dec');
  globalThis.__dirname = decDir;
  const decFactory = (
    await import('../squoosh/codecs/mozjpeg/dec/mozjpeg_node_dec.js')
  ).default;
  const wasmBinary = await fs.readFile(path.join(decDir, 'mozjpeg_node_dec.wasm'));
  return decFactory({ wasmBinary });
}

async function loadMozjpegEncoder() {
  const encDir = path.resolve('squoosh/codecs/mozjpeg/enc');
  globalThis.__dirname = encDir;
  const encFactory = (
    await import('../squoosh/codecs/mozjpeg/enc/mozjpeg_node_enc.js')
  ).default;
  const wasmBinary = await fs.readFile(path.join(encDir, 'mozjpeg_node_enc.wasm'));
  return encFactory({ wasmBinary });
}

async function loadPngCodec() {
  const pngDir = path.resolve('squoosh/codecs/png/pkg');
  const pngModule = await import('../squoosh/codecs/png/pkg/squoosh_png.js');
  const wasmBinary = await fs.readFile(path.join(pngDir, 'squoosh_png_bg.wasm'));
  await pngModule.default(wasmBinary);
  return pngModule;
}

async function createJpegFixture(filePath, rgba, width, height) {
  const encoder = await loadMozjpegEncoder();
  const data = encoder.encode(new Uint8ClampedArray(rgba), width, height, {
    quality: 92,
    baseline: false,
    arithmetic: false,
    progressive: true,
    optimize_coding: true,
    smoothing: 0,
    color_space: 3,
    quant_table: 3,
    trellis_multipass: false,
    trellis_opt_zero: false,
    trellis_opt_table: false,
    trellis_loops: 1,
    auto_subsample: true,
    chroma_subsample: 2,
    separate_chroma_quality: false,
    chroma_quality: 92,
  });
  await fs.writeFile(filePath, data);
}

async function createPngFixture(filePath, rgba, width, height) {
  const pngModule = await loadPngCodec();
  const data = pngModule.encode(new Uint8Array(rgba), width, height);
  await fs.writeFile(filePath, data);
}

test('parseCliArgs supports optional quality and input extensions', () => {
  const parsed = parseCliArgs([
    'D:\\images',
    '--quality',
    '81',
    '--input-ext',
    '.jpg,.png',
  ]);

  assert.equal(parsed.rootDir, 'D:\\images');
  assert.equal(parsed.quality, 81);
  assert.deepEqual(parsed.inputExtensions, ['.jpg', '.png']);
});

test('compressDirectory recursively writes mozjpeg outputs into per-directory imgs_outputs folders', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'compress-images-'));
  const nestedDir = path.join(tempRoot, 'chapter', 'section');
  const deepDir = path.join(nestedDir, 'topic');
  const existingOutputsDir = path.join(nestedDir, 'imgs_outputs');

  await fs.mkdir(deepDir, { recursive: true });
  await fs.mkdir(existingOutputsDir, { recursive: true });

  const jpgInput = path.join(nestedDir, 'photo.jpg');
  const pngInput = path.join(deepDir, 'icon.png');
  const skippedGif = path.join(nestedDir, 'ignored.gif');
  const alreadyGenerated = path.join(existingOutputsDir, 'already.jpg');

  await createJpegFixture(jpgInput, [255, 0, 0, 255], 1, 1);
  await createPngFixture(pngInput, [255, 0, 0, 0], 1, 1);
  await fs.writeFile(skippedGif, 'gif');
  await createJpegFixture(alreadyGenerated, [0, 0, 255, 255], 1, 1);

  const summary = await compressDirectory(tempRoot, {
    quality: 75,
    inputExtensions: ['.jpg', '.jpeg', '.png'],
  });

  const jpgOutput = path.join(nestedDir, 'imgs_outputs', 'photo.jpg');
  const pngOutput = path.join(deepDir, 'imgs_outputs', 'icon.jpg');
  const nestedOutputFromOutputsDir = path.join(
    existingOutputsDir,
    'imgs_outputs',
    'already.jpg',
  );

  await assert.doesNotReject(fs.access(jpgOutput));
  await assert.doesNotReject(fs.access(pngOutput));
  await assert.rejects(fs.access(nestedOutputFromOutputsDir));
  await assert.rejects(fs.access(path.join(nestedDir, 'imgs_outputs', 'ignored.jpg')));

  assert.equal(summary.processedCount, 2);
  assert.equal(summary.failedCount, 0);
  assert.equal(summary.skippedCount, 0);

  const decoder = await loadMozjpegDecoder();
  const decodedPngOutput = decoder.decode(new Uint8Array(await fs.readFile(pngOutput)));
  assert.ok(decodedPngOutput.data[0] >= 240);
  assert.ok(decodedPngOutput.data[1] >= 240);
  assert.ok(decodedPngOutput.data[2] >= 240);
});

test('compressDirectory reports git lfs pointer files with a clear error message', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'compress-images-lfs-'));
  const fakeJpg = path.join(tempRoot, 'broken.jpg');

  await fs.writeFile(
    fakeJpg,
    [
      'version https://git-lfs.github.com/spec/v1',
      'oid sha256:deadbeef',
      'size 12345',
      '',
    ].join('\n'),
  );

  const summary = await compressDirectory(tempRoot, {
    quality: 75,
    inputExtensions: ['.jpg', '.jpeg', '.png'],
  });

  assert.equal(summary.processedCount, 0);
  assert.equal(summary.failedCount, 1);
  assert.match(summary.failures[0].message, /Git LFS pointer file/i);
});

test('compressDirectory decodes files by signature instead of trusting a mismatched extension', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'compress-images-sniff-'));
  const disguisedPng = path.join(tempRoot, 'actually-png.jpg');

  await createPngFixture(disguisedPng, [0, 255, 0, 255], 1, 1);

  const summary = await compressDirectory(tempRoot, {
    quality: 75,
    inputExtensions: ['.jpg', '.jpeg', '.png'],
  });

  const outputPath = path.join(tempRoot, 'imgs_outputs', 'actually-png.jpg');

  await assert.doesNotReject(fs.access(outputPath));
  assert.equal(summary.processedCount, 1);
  assert.equal(summary.failedCount, 0);
});
