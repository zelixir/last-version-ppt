import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRenamedProjectId, DEFAULT_INDEX_JS } from './storage.ts';

test('buildRenamedProjectId keeps date prefix', () => {
  assert.equal(buildRenamedProjectId('20260311_old-name', '新的名字'), '20260311_新的名字');
});

test('buildRenamedProjectId keeps version suffix', () => {
  assert.equal(buildRenamedProjectId('20260311_old-name_v02', '品牌介绍'), '20260311_品牌介绍_v02');
});

test('DEFAULT_INDEX_JS uses the verified three-page default template', () => {
  assert.match(DEFAULT_INDEX_JS, /fontSize: 88/);
  assert.match(DEFAULT_INDEX_JS, /fontSize: 72/);
  assert.match(DEFAULT_INDEX_JS, /fontSize: 56/);
  assert.match(DEFAULT_INDEX_JS, /fontSize: 48/);
  assert.match(DEFAULT_INDEX_JS, /margin: 0/);
  assert.match(DEFAULT_INDEX_JS, /封面/);
  assert.match(DEFAULT_INDEX_JS, /目录/);
  assert.match(DEFAULT_INDEX_JS, /正文/);
  assert.match(DEFAULT_INDEX_JS, /默认包含封面、目录和正文 3 页结构/);
});
