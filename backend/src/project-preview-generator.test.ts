import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'fs';
import { generateProjectPreviewImages } from './project-preview-generator.ts';
import { readProjectPreviewImage } from './project-preview-cache.ts';
import { createProjectFiles, getProjectDir } from './storage.ts';

async function withTestProject(run: (projectId: string) => Promise<void> | void) {
  const projectId = `test-preview-generator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createProjectFiles(projectId);
  try {
    await run(projectId);
  } finally {
    rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
}

test('generateProjectPreviewImages 会把服务端生成的图片写进 preview 文件夹', async () => {
  await withTestProject(async projectId => {
    const result = await generateProjectPreviewImages(projectId, Uint8Array.from([1, 2, 3]), {
      renderPreviews: async () => [
        { pageNumber: 2, data: Uint8Array.from([5, 6, 7, 8]) },
        { pageNumber: 1, data: Uint8Array.from([1, 2, 3, 4]) },
      ],
    });

    assert.equal(result.slideCount, 2);
    assert.deepEqual(result.images.map(image => image.pageNumber), [1, 2]);
    assert.match(result.images[0]?.url ?? '', new RegExp(`/api/projects/${projectId}/files/raw\\?fileName=preview%2Fslide-1\\.png`));

    const preview = readProjectPreviewImage(projectId, 1);
    assert.equal(preview.slideCount, 2);
    assert.equal(Buffer.from(preview.data, 'base64').toString('hex'), '01020304');
  });
});

test('generateProjectPreviewImages 会把任务串行执行，避免并发占用同一个预览引擎', async () => {
  await withTestProject(async projectId => {
    const steps: string[] = [];
    let releaseFirstTask: () => void = () => {
      throw new Error('第一个任务还没有准备好');
    };

    const firstTask = generateProjectPreviewImages(projectId, Uint8Array.from([1]), {
      renderPreviews: async () => {
        steps.push('start-1');
        await new Promise<void>(resolve => {
          releaseFirstTask = () => {
            steps.push('finish-1');
            resolve();
          };
        });
        return [{ pageNumber: 1, data: Uint8Array.from([1]) }];
      },
    });

    const secondTask = generateProjectPreviewImages(projectId, Uint8Array.from([2]), {
      renderPreviews: async () => {
        steps.push('start-2');
        return [{ pageNumber: 1, data: Uint8Array.from([2]) }];
      },
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(steps, ['start-1']);

    releaseFirstTask();
    await Promise.all([firstTask, secondTask]);
    assert.deepEqual(steps, ['start-1', 'finish-1', 'start-2']);
  });
});
