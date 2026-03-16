import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRenamedProjectId, DEFAULT_INDEX_JS } from './storage.ts';
import { recommendSingleLineChars } from './ppt-text-layout.ts';

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
  assert.match(DEFAULT_INDEX_JS, /h: 1\.49/);
  assert.match(DEFAULT_INDEX_JS, /h: 1\.23/);
  assert.match(DEFAULT_INDEX_JS, /h: 0\.96/);
  assert.match(DEFAULT_INDEX_JS, /h: 0\.83/);
  assert.match(DEFAULT_INDEX_JS, /h: 2\.43/);
  assert.match(DEFAULT_INDEX_JS, /margin: 0/);
  assert.match(DEFAULT_INDEX_JS, /封面/);
  assert.match(DEFAULT_INDEX_JS, /目录/);
  assert.match(DEFAULT_INDEX_JS, /正文/);
  assert.match(DEFAULT_INDEX_JS, /先讲清主题和要解决的问题/);
  assert.match(DEFAULT_INDEX_JS, /把章节顺序列出来方便理解/);
  assert.match(DEFAULT_INDEX_JS, /按重点展开说明并补后续动作/);
  assert.match(DEFAULT_INDEX_JS, /写清负责人、时间和结果/);
  assert.match(DEFAULT_INDEX_JS, /默认包含封面、目录和正文 3 页结构/);
});

test('DEFAULT_INDEX_JS keeps single-line sample text within the safe character budget', () => {
  const agendaSafeChars = recommendSingleLineChars(6.98, 48);
  const bodySideSafeChars = recommendSingleLineChars(5.16, 48);

  for (const text of [
    '先讲清主题和要解决的问题。',
    '把章节顺序列出来方便理解。',
    '按重点展开说明并补后续动作。',
  ]) {
    assert.ok(text.length <= agendaSafeChars, `${text} should fit into the agenda description box`);
  }

  for (const text of [
    '把最重要的结果放在这里。',
    '写清负责人、时间和结果。',
  ]) {
    assert.ok(text.length <= bodySideSafeChars, `${text} should fit into the body side text box`);
  }
});
