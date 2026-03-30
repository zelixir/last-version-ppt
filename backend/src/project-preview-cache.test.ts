import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync, writeFileSync } from 'fs';
import {
  buildProjectPreviewImageResponses,
  computeProjectScriptHash,
  listProjectPreviewImages,
  replaceProjectPreviewImages,
  writeProjectPreviewMetadata,
} from './project-preview-cache.ts';
import { getCachedProjectPreview } from './project-preview.ts';
import { createProjectFiles, getProjectDir, resolveProjectFile } from './storage.ts';

async function withTestProject(run: (projectId: string) => Promise<void> | void) {
  const projectId = `preview-cache-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  createProjectFiles(projectId);
  try {
    await run(projectId);
  } finally {
    rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
}

test('getCachedProjectPreview 会在脚本未改动时直接返回已缓存的预览', async () => {
  await withTestProject(async projectId => {
    replaceProjectPreviewImages(projectId, [{ pageNumber: 1, data: Uint8Array.from([1, 2, 3]) }]);
    const scriptHash = computeProjectScriptHash(projectId);
    assert.ok(scriptHash);

    const storedImages = listProjectPreviewImages(projectId);
    const images = buildProjectPreviewImageResponses(projectId, storedImages);
    writeProjectPreviewMetadata(projectId, {
      scriptHash,
      generatedAt: new Date().toISOString(),
      slideCount: 1,
      presentation: { width: 10, height: 5, slides: [], logs: [] },
      images,
    });

    const cached = getCachedProjectPreview(projectId, scriptHash);
    assert.ok(cached);
    assert.equal(cached.images.length, 1);
    assert.equal(cached.presentation.width, 10);
    assert.equal(cached.presentation.height, 5);

    const mismatched = getCachedProjectPreview(projectId, 'different-hash');
    assert.equal(mismatched, null);
  });
});

test('computeProjectScriptHash 会随着分页脚本变化而变化', async () => {
  await withTestProject(async projectId => {
    const originalHash = computeProjectScriptHash(projectId);
    assert.ok(originalHash);

    writeFileSync(resolveProjectFile(projectId, 'page01.js'), "module.exports = async function ({ slide }) { slide.addText('第一页', { x: 0.5, y: 0.5, w: 2, h: 0.6 }); };\n", 'utf8');
    const nextHash = computeProjectScriptHash(projectId);
    assert.ok(nextHash);
    assert.notEqual(nextHash, originalHash);
  });
});
