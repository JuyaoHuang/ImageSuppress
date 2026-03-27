import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  parseCliArgs,
  publishCompressedImages,
} from '../src/publish-compressed-images.mjs';

test('parseCliArgs reads the root directory', () => {
  const parsed = parseCliArgs(['D:\\blogs\\Acknowledge']);
  assert.equal(parsed.rootDir, 'D:\\blogs\\Acknowledge');
});

test('publishCompressedImages promotes imgs_outputs files and rewrites markdown image references in the subtree', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-images-'));
  const articleDir = path.join(tempRoot, 'notes');
  const imageDir = path.join(articleDir, 'assets');
  const outputDir = path.join(imageDir, 'imgs_outputs');
  const articlePath = path.join(articleDir, 'lesson.md');
  const siblingArticlePath = path.join(articleDir, 'second.md');

  await fs.mkdir(outputDir, { recursive: true });

  await fs.writeFile(path.join(imageDir, '1.png'), 'original-png');
  await fs.writeFile(path.join(imageDir, '2.jpg'), 'original-jpg');
  await fs.writeFile(path.join(outputDir, '1.jpg'), 'compressed-from-png');
  await fs.writeFile(path.join(outputDir, '2.jpg'), 'compressed-from-jpg');

  await fs.writeFile(
    articlePath,
    [
      '# Lesson',
      '![one](./assets/1.png)',
      '![two](./assets/2.jpg)',
      '<img src="./assets/1.png" alt="png" />',
      '<img src="./assets/2.jpg" alt="jpg" />',
      '',
    ].join('\n'),
  );

  await fs.writeFile(
    siblingArticlePath,
    ['![sibling](./assets/1.png)', '![keep](./assets/2.jpg)', ''].join('\n'),
  );

  const summary = await publishCompressedImages(tempRoot);

  const promotedPngPath = path.join(imageDir, '1.jpg');
  const promotedJpgPath = path.join(imageDir, '2.jpg');

  await assert.rejects(fs.access(path.join(imageDir, '1.png')));
  await assert.doesNotReject(fs.access(promotedPngPath));
  await assert.doesNotReject(fs.access(promotedJpgPath));
  await assert.rejects(fs.access(outputDir));

  assert.equal(await fs.readFile(promotedPngPath, 'utf8'), 'compressed-from-png');
  assert.equal(await fs.readFile(promotedJpgPath, 'utf8'), 'compressed-from-jpg');

  const articleContent = await fs.readFile(articlePath, 'utf8');
  const siblingContent = await fs.readFile(siblingArticlePath, 'utf8');

  assert.match(articleContent, /!\[one\]\(\.\/assets\/1\.jpg\)/);
  assert.match(articleContent, /!\[two\]\(\.\/assets\/2\.jpg\)/);
  assert.match(articleContent, /<img src="\.\/assets\/1\.jpg" alt="png" \/>/);
  assert.match(articleContent, /<img src="\.\/assets\/2\.jpg" alt="jpg" \/>/);
  assert.match(siblingContent, /!\[sibling\]\(\.\/assets\/1\.jpg\)/);

  assert.equal(summary.publishedCount, 2);
  assert.equal(summary.updatedMarkdownCount, 2);
  assert.equal(summary.deletedOriginalCount, 2);
});
