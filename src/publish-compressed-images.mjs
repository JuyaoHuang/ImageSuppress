import fs from 'node:fs/promises';
import path from 'node:path';

const OUTPUT_DIRECTORY_NAME = 'imgs_outputs';
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);
const SOURCE_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

function isAbsoluteWindowsPath(value) {
  return /^[a-zA-Z]:[\\/]/.test(value);
}

function isExternalTarget(value) {
  return /^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/)/.test(value);
}

function normalizeAbsolutePathForLookup(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function toMarkdownRelativePath(fromDir, targetPath) {
  const relativePath = path.relative(fromDir, targetPath).split(path.sep).join('/');
  if (relativePath.startsWith('.')) {
    return relativePath;
  }
  return `./${relativePath}`;
}

function splitTargetSuffix(target) {
  const match = target.match(/^([^?#]+)([?#].*)?$/);
  return {
    pathname: match ? match[1] : target,
    suffix: match?.[2] ?? '',
  };
}

function replaceLocalTarget(target, markdownDir, renameMap) {
  if (!target || target.startsWith('#') || isAbsoluteWindowsPath(target) || isExternalTarget(target)) {
    return target;
  }

  const { pathname, suffix } = splitTargetSuffix(target);
  const absolutePath = normalizeAbsolutePathForLookup(path.resolve(markdownDir, pathname));
  const replacement = renameMap.get(absolutePath);
  if (!replacement) {
    return target;
  }

  return `${toMarkdownRelativePath(markdownDir, replacement)}${suffix}`;
}

async function collectFiles(rootDir, predicate) {
  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      if (entry.isFile() && predicate(entry.name, absolutePath)) {
        files.push(absolutePath);
      }
    }
  }

  return files.sort();
}

async function collectOutputDirectories(rootDir) {
  const directories = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === OUTPUT_DIRECTORY_NAME) {
        directories.push(absolutePath);
        continue;
      }

      queue.push(absolutePath);
    }
  }

  return directories.sort();
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function chooseOriginalImage(parentDir, outputFileName) {
  const parsed = path.parse(outputFileName);
  const exactMatch = path.join(parentDir, outputFileName);
  if (await fileExists(exactMatch)) {
    return exactMatch;
  }

  for (const extension of SOURCE_IMAGE_EXTENSIONS) {
    const candidate = path.join(parentDir, `${parsed.name}${extension}`);
    if (candidate === exactMatch) continue;
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function promoteOutputFile(outputFilePath, renameMap) {
  const outputDir = path.dirname(outputFilePath);
  const parentDir = path.dirname(outputDir);
  const outputFileName = path.basename(outputFilePath);
  const finalPath = path.join(parentDir, outputFileName);
  const originalPath = await chooseOriginalImage(parentDir, outputFileName);

  let deletedOriginal = false;
  let oldReferencePath = null;

  if (originalPath) {
    oldReferencePath = originalPath;
    await fs.rm(originalPath, { force: true });
    deletedOriginal = true;
  }

  await fs.rename(outputFilePath, finalPath);

  if (oldReferencePath && normalizeAbsolutePathForLookup(oldReferencePath) !== normalizeAbsolutePathForLookup(finalPath)) {
    renameMap.set(normalizeAbsolutePathForLookup(oldReferencePath), finalPath);
  }

  return {
    outputFilePath,
    finalPath,
    deletedOriginal,
  };
}

async function removeDirectoryIfEmpty(directoryPath) {
  const entries = await fs.readdir(directoryPath);
  if (entries.length === 0) {
    await fs.rmdir(directoryPath);
    return true;
  }
  return false;
}

async function updateMarkdownFile(markdownPath, renameMap) {
  const originalContent = await fs.readFile(markdownPath, 'utf8');
  const markdownDir = path.dirname(markdownPath);

  const rewrittenContent = originalContent
    .replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (match, prefix, target, suffix) => {
      const nextTarget = replaceLocalTarget(target, markdownDir, renameMap);
      return nextTarget === target ? match : `${prefix}${nextTarget}${suffix}`;
    })
    .replace(
      /(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
      (match, prefix, target, suffix) => {
        const nextTarget = replaceLocalTarget(target, markdownDir, renameMap);
        return nextTarget === target ? match : `${prefix}${nextTarget}${suffix}`;
      },
    );

  if (rewrittenContent === originalContent) {
    return false;
  }

  await fs.writeFile(markdownPath, rewrittenContent);
  return true;
}

export function parseCliArgs(argv) {
  const [rootDir, ...rest] = argv;
  if (!rootDir) {
    throw new Error('Missing root directory argument');
  }

  if (rest.length > 0) {
    throw new Error(`Unexpected extra arguments: ${rest.join(' ')}`);
  }

  return { rootDir };
}

export async function publishCompressedImages(rootDir) {
  const absoluteRootDir = path.resolve(rootDir);
  const rootStat = await fs.stat(absoluteRootDir).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`Root directory does not exist or is not a directory: ${absoluteRootDir}`);
  }

  const outputDirectories = await collectOutputDirectories(absoluteRootDir);
  const renameMap = new Map();
  const summary = {
    rootDir: absoluteRootDir,
    publishedCount: 0,
    updatedMarkdownCount: 0,
    deletedOriginalCount: 0,
    removedOutputDirectories: 0,
  };

  for (const outputDirectory of outputDirectories) {
    const outputFiles = await collectFiles(outputDirectory, (name) => {
      const extension = path.extname(name).toLowerCase();
      return extension === '.jpg';
    });

    for (const outputFile of outputFiles) {
      const result = await promoteOutputFile(outputFile, renameMap);
      summary.publishedCount += 1;
      if (result.deletedOriginal) {
        summary.deletedOriginalCount += 1;
      }
    }

    if (await removeDirectoryIfEmpty(outputDirectory)) {
      summary.removedOutputDirectories += 1;
    }
  }

  const markdownFiles = await collectFiles(absoluteRootDir, (name) =>
    MARKDOWN_EXTENSIONS.has(path.extname(name).toLowerCase()),
  );

  for (const markdownFile of markdownFiles) {
    const updated = await updateMarkdownFile(markdownFile, renameMap);
    if (updated) {
      summary.updatedMarkdownCount += 1;
    }
  }

  return summary;
}

export async function runCli(argv = process.argv.slice(2), io = console) {
  const parsed = parseCliArgs(argv);
  const summary = await publishCompressedImages(parsed.rootDir);

  io.log(`Published: ${summary.publishedCount}`);
  io.log(`Markdown updated: ${summary.updatedMarkdownCount}`);
  io.log(`Originals deleted: ${summary.deletedOriginalCount}`);
  io.log(`Removed imgs_outputs directories: ${summary.removedOutputDirectories}`);

  return 0;
}
