import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolCapabilitySummary } from './project-agent.ts';

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
