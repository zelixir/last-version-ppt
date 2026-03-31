import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'fs';
import { buildProjectAgentSystemPrompt, buildToolCapabilitySummary, limitRunProjectWarningsForTool } from './project-agent.ts';
import { createProjectFiles, getProjectDir } from './storage.ts';

test('buildToolCapabilitySummary groups enabled tools into concise capability lines', () => {
  const summary = buildToolCapabilitySummary([
    'create-project',
    'read-file',
    'write-file',
    'run-project',
    'read-image-file',
  ]);

  assert.match(summary, /项目整理：/)
  assert.match(summary, /文件处理：/)
  assert.match(summary, /检查效果：/)
  assert.match(summary, /看图辅助：/)
  assert.doesNotMatch(summary, /switch-project/)
});

test('buildProjectAgentSystemPrompt 明确要求代码换行使用真实换行符', () => {
  const projectId = `test-project-agent-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createProjectFiles(projectId);
  try {
    const prompt = buildProjectAgentSystemPrompt(projectId, true, ['run-project', 'read-file', 'write-file']);
    assert.match(prompt, /真正的换行/);
    assert.match(prompt, /\\n/);
    assert.match(prompt, /write-file/);
    assert.doesNotMatch(prompt, /apply-patch/);
    assert.match(prompt, /文字重叠/);
    assert.match(prompt, /控制台日志/);
    assert.doesNotMatch(prompt, /挤在一起/);
  } finally {
    rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('buildProjectAgentSystemPrompt 即使传入 apply-patch 也会被硬编码开关隐藏', () => {
  const projectId = `test-project-agent-prompt-no-patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createProjectFiles(projectId);
  try {
    const prompt = buildProjectAgentSystemPrompt(projectId, true, ['run-project', 'read-file', 'write-file', 'apply-patch']);
    assert.doesNotMatch(prompt, /apply-patch/);
  } finally {
    rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('buildProjectAgentSystemPrompt 非多模态模型提示用户切换到多模态模型查看预览', () => {
  const projectId = `test-prompt-multimodal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createProjectFiles(projectId);
  try {
    const prompt = buildProjectAgentSystemPrompt(projectId, false, ['run-project', 'read-file']);
    assert.match(prompt, /多模态/);
    assert.match(prompt, /预览效果/);
  } finally {
    rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('limitRunProjectWarningsForTool 每页最多保留 5 条文字重叠提醒', () => {
  const warnings = [
    '第一页：标题和副标题发生重叠',
    '第一页：正文和图表发生重叠',
    '第一页：页脚和正文发生重叠',
    '第一页：图例和柱状图发生重叠',
    '第一页：表格和说明文字发生重叠',
    '第一页：备注和边框发生重叠',
    '第二页：卡片一和卡片二发生重叠',
    '第二页：卡片三和卡片四发生重叠',
    '导出前请检查配色',
  ];

  assert.deepEqual(limitRunProjectWarningsForTool(warnings), [
    '第一页：标题和副标题发生重叠',
    '第一页：正文和图表发生重叠',
    '第一页：页脚和正文发生重叠',
    '第一页：图例和柱状图发生重叠',
    '第一页：表格和说明文字发生重叠',
    '第二页：卡片一和卡片二发生重叠',
    '第二页：卡片三和卡片四发生重叠',
    '导出前请检查配色',
    '第一页：其余 1 条文字重叠提醒已省略，请查看控制台里的完整提醒。',
  ]);
});
