import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'fs';
import { buildProjectAgentSystemPrompt, buildToolCapabilitySummary } from './project-agent.ts';
import { createProjectFiles, getProjectDir } from './storage.ts';

test('buildToolCapabilitySummary groups enabled tools into concise capability lines', () => {
  const summary = buildToolCapabilitySummary([
    'create-project',
    'read-file',
    'apply-patch',
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
    const prompt = buildProjectAgentSystemPrompt(projectId, true, ['run-project', 'read-file']);
    assert.match(prompt, /真正的换行/);
    assert.match(prompt, /\\n/);
  } finally {
    rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});
