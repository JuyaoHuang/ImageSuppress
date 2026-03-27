import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const DEFAULT_QUALITY = 80;
const DEFAULT_INPUT_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const OUTPUT_DIRECTORY_NAME = 'imgs_outputs';
const JPEG_EXTENSION_SET = new Set(['.jpg', '.jpeg']);

let mozjpegEncoderPromise;
let mozjpegDecoderPromise;
let pngCodecPromise;

const GIT_LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';

function ensureNodeCompatGlobals() {
  if (!globalThis.ImageData) {
    globalThis.ImageData = class ImageData {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    };
  }

  if (!globalThis.require) {
    globalThis.require = createRequire(import.meta.url);
  }
}

function getDefaultMozjpegOptions(quality) {
  return {
    quality,
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
    chroma_quality: quality,
  };
}

async function loadMozjpegEncoder() {
  if (!mozjpegEncoderPromise) {
    mozjpegEncoderPromise = (async () => {
      ensureNodeCompatGlobals();
      const encDir = path.resolve('squoosh/codecs/mozjpeg/enc');
      globalThis.__dirname = encDir;
      const moduleFactory = (
        await import('../squoosh/codecs/mozjpeg/enc/mozjpeg_node_enc.js')
      ).default;
      const wasmBinary = await fs.readFile(path.join(encDir, 'mozjpeg_node_enc.wasm'));
      return moduleFactory({ wasmBinary });
    })();
  }

  return mozjpegEncoderPromise;
}

async function loadMozjpegDecoder() {
  if (!mozjpegDecoderPromise) {
    mozjpegDecoderPromise = (async () => {
      ensureNodeCompatGlobals();
      const decDir = path.resolve('squoosh/codecs/mozjpeg/dec');
      globalThis.__dirname = decDir;
      const moduleFactory = (
        await import('../squoosh/codecs/mozjpeg/dec/mozjpeg_node_dec.js')
      ).default;
      const wasmBinary = await fs.readFile(path.join(decDir, 'mozjpeg_node_dec.wasm'));
      return moduleFactory({ wasmBinary });
    })();
  }

  return mozjpegDecoderPromise;
}

async function loadPngCodec() {
  if (!pngCodecPromise) {
    pngCodecPromise = (async () => {
      ensureNodeCompatGlobals();
      const pngDir = path.resolve('squoosh/codecs/png/pkg');
      const pngModule = await import('../squoosh/codecs/png/pkg/squoosh_png.js');
      const wasmBinary = await fs.readFile(path.join(pngDir, 'squoosh_png_bg.wasm'));
      await pngModule.default(wasmBinary);
      return pngModule;
    })();
  }

  return pngCodecPromise;
}

function normalizeInputExtensions(inputExtensions = DEFAULT_INPUT_EXTENSIONS) {
  if (!Array.isArray(inputExtensions) || inputExtensions.length === 0) {
    return [...DEFAULT_INPUT_EXTENSIONS];
  }

  const normalized = [];
  for (const extension of inputExtensions) {
    const value = String(extension).trim().toLowerCase();
    if (!value) continue;
    normalized.push(value.startsWith('.') ? value : `.${value}`);
  }

  return normalized.length > 0 ? [...new Set(normalized)] : [...DEFAULT_INPUT_EXTENSIONS];
}

function normalizeQuality(quality = DEFAULT_QUALITY) {
  const value = Number(quality);
  if (!Number.isFinite(value) || value < 1 || value > 100) {
    throw new Error(`Invalid --quality value: ${quality}`);
  }
  return Math.round(value);
}

function outputFileNameFor(inputFileName) {
  const parsed = path.parse(inputFileName);
  const extension = parsed.ext.toLowerCase();
  if (JPEG_EXTENSION_SET.has(extension)) {
    return parsed.base;
  }
  return `${parsed.name}.jpg`;
}

function isGitLfsPointer(sourceBytes) {
  const probe = new TextDecoder('utf-8').decode(sourceBytes.subarray(0, 128));
  return probe.startsWith(GIT_LFS_POINTER_PREFIX);
}

function sniffImageFormat(sourceBytes) {
  if (
    sourceBytes[0] === 0xff &&
    sourceBytes[1] === 0xd8 &&
    sourceBytes[2] === 0xff
  ) {
    return 'jpeg';
  }

  if (
    sourceBytes[0] === 0x89 &&
    sourceBytes[1] === 0x50 &&
    sourceBytes[2] === 0x4e &&
    sourceBytes[3] === 0x47 &&
    sourceBytes[4] === 0x0d &&
    sourceBytes[5] === 0x0a &&
    sourceBytes[6] === 0x1a &&
    sourceBytes[7] === 0x0a
  ) {
    return 'png';
  }

  if (sourceBytes[0] === 0x42 && sourceBytes[1] === 0x4d) {
    return 'bmp';
  }

  return 'unknown';
}

function flattenImageOnWhite(image) {
  const flattened = new Uint8ClampedArray(image.data.length);

  for (let index = 0; index < image.data.length; index += 4) {
    const alpha = image.data[index + 3] / 255;
    const backgroundWeight = 1 - alpha;

    flattened[index] = Math.round(image.data[index] * alpha + 255 * backgroundWeight);
    flattened[index + 1] = Math.round(
      image.data[index + 1] * alpha + 255 * backgroundWeight,
    );
    flattened[index + 2] = Math.round(
      image.data[index + 2] * alpha + 255 * backgroundWeight,
    );
    flattened[index + 3] = 255;
  }

  return new ImageData(flattened, image.width, image.height);
}

async function decodeInputImage(filePath, extension) {
  const source = new Uint8Array(await fs.readFile(filePath));

  if (isGitLfsPointer(source)) {
    throw new Error(
      'Git LFS pointer file detected. The real image content is not present locally. Fetch LFS assets first, for example with `git lfs pull` in the source repository.',
    );
  }

  const detectedFormat = sniffImageFormat(source);

  if (detectedFormat === 'png') {
    const pngCodec = await loadPngCodec();
    return {
      image: pngCodec.decode(source),
      detectedFormat,
    };
  }

  if (detectedFormat === 'jpeg') {
    const decoder = await loadMozjpegDecoder();
    return {
      image: decoder.decode(source),
      detectedFormat,
    };
  }

  if (detectedFormat === 'bmp') {
    throw new Error(
      `Unsupported image format for ${filePath}: BMP is not supported yet.`,
    );
  }

  throw new Error(
    `Unsupported or unrecognized image content for ${filePath} (extension: ${extension}).`,
  );
}

async function encodeMozjpeg(image, quality) {
  const encoder = await loadMozjpegEncoder();
  return encoder.encode(
    image.data,
    image.width,
    image.height,
    getDefaultMozjpegOptions(quality),
  );
}

async function collectInputFiles(rootDir, inputExtensions, outputDirectoryName) {
  const files = [];
  const pending = [rootDir];

  while (pending.length > 0) {
    const currentDir = pending.pop();
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === outputDirectoryName) continue;
        pending.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name).toLowerCase();
      if (inputExtensions.includes(extension)) {
        files.push(absolutePath);
      }
    }
  }

  return files.sort();
}

async function compressSingleFile(filePath, quality) {
  const extension = path.extname(filePath).toLowerCase();
  const sourceStat = await fs.stat(filePath);
  const { image, detectedFormat } = await decodeInputImage(filePath, extension);
  const prepared = detectedFormat === 'png' ? flattenImageOnWhite(image) : image;
  const encoded = await encodeMozjpeg(prepared, quality);

  const outputDir = path.join(path.dirname(filePath), OUTPUT_DIRECTORY_NAME);
  const outputPath = path.join(outputDir, outputFileNameFor(path.basename(filePath)));

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, encoded);

  return {
    inputPath: filePath,
    outputPath,
    originalBytes: sourceStat.size,
    outputBytes: encoded.length,
  };
}

export function parseCliArgs(argv) {
  const args = [...argv];
  let rootDir;
  let quality = DEFAULT_QUALITY;
  let inputExtensions = [...DEFAULT_INPUT_EXTENSIONS];

  while (args.length > 0) {
    const current = args.shift();

    if (!current.startsWith('--')) {
      if (rootDir) {
        throw new Error(`Unexpected extra argument: ${current}`);
      }
      rootDir = current;
      continue;
    }

    if (current === '--quality') {
      quality = args.shift();
      if (quality === undefined) throw new Error('Missing value for --quality');
      continue;
    }

    if (current.startsWith('--quality=')) {
      quality = current.slice('--quality='.length);
      continue;
    }

    if (current === '--input-ext') {
      const value = args.shift();
      if (value === undefined) throw new Error('Missing value for --input-ext');
      inputExtensions = value.split(',');
      continue;
    }

    if (current.startsWith('--input-ext=')) {
      inputExtensions = current.slice('--input-ext='.length).split(',');
      continue;
    }

    if (current === '--help' || current === '-h') {
      return { help: true };
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  if (!rootDir) {
    throw new Error('Missing root directory argument');
  }

  return {
    rootDir,
    quality: normalizeQuality(quality),
    inputExtensions: normalizeInputExtensions(inputExtensions),
  };
}

export async function compressDirectory(rootDir, options = {}) {
  const quality = normalizeQuality(options.quality ?? DEFAULT_QUALITY);
  const inputExtensions = normalizeInputExtensions(
    options.inputExtensions ?? DEFAULT_INPUT_EXTENSIONS,
  );
  const absoluteRootDir = path.resolve(rootDir);

  const rootStat = await fs.stat(absoluteRootDir).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`Root directory does not exist or is not a directory: ${absoluteRootDir}`);
  }

  const files = await collectInputFiles(
    absoluteRootDir,
    inputExtensions,
    OUTPUT_DIRECTORY_NAME,
  );

  const summary = {
    rootDir: absoluteRootDir,
    quality,
    inputExtensions,
    processedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    originalBytes: 0,
    outputBytes: 0,
    failures: [],
    outputs: [],
  };

  for (const filePath of files) {
    try {
      const result = await compressSingleFile(filePath, quality);
      summary.processedCount += 1;
      summary.originalBytes += result.originalBytes;
      summary.outputBytes += result.outputBytes;
      summary.outputs.push(result);
    } catch (error) {
      summary.failedCount += 1;
      summary.failures.push({
        inputPath: filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}

function formatRatio(originalBytes, outputBytes) {
  if (originalBytes <= 0) return '0.00%';
  const savedRatio = ((originalBytes - outputBytes) / originalBytes) * 100;
  return `${savedRatio.toFixed(2)}%`;
}

export async function runCli(argv = process.argv.slice(2), io = console) {
  const parsed = parseCliArgs(argv);

  if (parsed.help) {
    io.log(
      [
        'Usage:',
        '  node scripts/compress-images.mjs <rootDir> [--quality 75] [--input-ext .jpg,.jpeg,.png]',
        '',
        'Behavior:',
        '  Recursively scans <rootDir>, skips any imgs_outputs directories, and writes mozJPEG outputs',
        '  into a sibling imgs_outputs folder for each source image directory.',
      ].join('\n'),
    );
    return 0;
  }

  const summary = await compressDirectory(parsed.rootDir, {
    quality: parsed.quality,
    inputExtensions: parsed.inputExtensions,
  });

  for (const output of summary.outputs) {
    io.log(
      `${output.inputPath} -> ${output.outputPath} (${output.originalBytes} -> ${output.outputBytes} bytes)`,
    );
  }

  for (const failure of summary.failures) {
    io.error(`Failed: ${failure.inputPath}`);
    io.error(`  ${failure.message}`);
  }

  io.log(
    [
      '',
      `Processed: ${summary.processedCount}`,
      `Failed: ${summary.failedCount}`,
      `Original bytes: ${summary.originalBytes}`,
      `Output bytes: ${summary.outputBytes}`,
      `Saved: ${formatRatio(summary.originalBytes, summary.outputBytes)}`,
    ].join('\n'),
  );

  return summary.failedCount > 0 ? 1 : 0;
}
