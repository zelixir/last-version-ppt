#!/usr/bin/env bun

import { listProjects } from './db.ts';
import { generateProjectPreview } from './project-preview.ts';

function parseTargets(argv: string[]): string[] {
  const ids = argv.filter(Boolean).map(arg => arg.trim()).filter(Boolean);
  if (ids.length > 0) return ids;
  return listProjects().slice(0, 3).map(project => project.id);
}

async function previewOne(projectId: string) {
  console.log(`\n[预览] 正在处理 ${projectId} …`);
  try {
    const result = await generateProjectPreview(projectId);
    console.log(`[预览] ${projectId} 已完成，生成 ${result.images.length} 张预览图。`);
  } catch (error) {
    console.error(`[预览] ${projectId} 生成失败：`, error instanceof Error ? error.message : String(error));
  }
}

async function run() {
  const targets = parseTargets(process.argv.slice(2));
  if (!targets.length) {
    console.log('当前没有可预览的项目。');
    return;
  }

  for (let index = 0; index < targets.length; index += 1) {
    const projectId = targets[index];
    await previewOne(projectId);
    if (index < targets.length - 1) {
      console.log('[预览] 等待 3 秒后继续下一个项目…');
      await Bun.sleep(3_000);
    }
  }

  console.log('\n[预览] 批量预览任务已结束。');
}

run().catch(error => {
  console.error('[预览] 批量预览任务异常：', error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
