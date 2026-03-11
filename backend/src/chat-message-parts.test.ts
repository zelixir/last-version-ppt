import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTextPart, mergeToolPart } from './chat-message-parts.ts';
import type { ProjectChatMessagePart } from './db.ts';

test('appendTextPart merges consecutive text content', () => {
  const parts: ProjectChatMessagePart[] = [];
  appendTextPart(parts, '文本1');
  appendTextPart(parts, '文本2');

  assert.deepEqual(parts, [{ type: 'text', text: '文本1文本2' }]);
});

test('mergeToolPart keeps tool cards in original order while updating running state', () => {
  const parts: ProjectChatMessagePart[] = [];

  appendTextPart(parts, '先说一句');
  mergeToolPart(parts, { toolName: 'list-file', summary: '正在查看文件', state: 'running' });
  appendTextPart(parts, '再补一句');
  mergeToolPart(parts, { toolName: 'list-file', summary: '已找到 3 个文件', state: 'done', success: true });

  assert.deepEqual(parts, [
    { type: 'text', text: '先说一句' },
    { type: 'tool', toolName: 'list-file', summary: '已找到 3 个文件', success: true, state: 'done' },
    { type: 'text', text: '再补一句' },
  ]);
});
