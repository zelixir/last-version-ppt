import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRenamedProjectId, buildUniqueProjectId, DEFAULT_INDEX_JS } from './storage.ts';
import { doesTextFitSingleLine, recommendSingleLineChars } from './ppt-text-layout.ts';

test('buildRenamedProjectId keeps date prefix', () => {
  assert.equal(buildRenamedProjectId('20260311_old-name', '新的名字'), '20260311_新的名字');
});

test('buildRenamedProjectId keeps version suffix', () => {
  assert.equal(buildRenamedProjectId('20260311_old-name_v02', '品牌介绍'), '20260311_品牌介绍_v02');
});

test('buildUniqueProjectId adds a numeric suffix when the base id is already occupied', () => {
  const occupiedIds = new Set(['20260317_品牌介绍', '20260317_品牌介绍-02']);
  assert.equal(
    buildUniqueProjectId('品牌介绍', projectId => !occupiedIds.has(projectId), new Date('2026-03-17T00:00:00Z')),
    '20260317_品牌介绍-03',
  );
});

test('DEFAULT_INDEX_JS uses the verified three-page default template', () => {
  assert.match(DEFAULT_INDEX_JS, /measureText/);
  assert.match(DEFAULT_INDEX_JS, /await addMeasuredText/);
  assert.match(DEFAULT_INDEX_JS, /assert/);
  assert.match(DEFAULT_INDEX_JS, /const fontFace = 'Noto Sans CJK SC'/);
  assert.match(DEFAULT_INDEX_JS, /fontFace, margin: 0/);
  assert.match(DEFAULT_INDEX_JS, /fontSize: 88/);
  assert.match(DEFAULT_INDEX_JS, /fontSize: 72/);
  assert.match(DEFAULT_INDEX_JS, /fontSize: 56/);
  assert.match(DEFAULT_INDEX_JS, /fontSize: 48/);
  assert.match(DEFAULT_INDEX_JS, /margin: 0/);
  assert.match(DEFAULT_INDEX_JS, /封面/);
  assert.match(DEFAULT_INDEX_JS, /目录/);
  assert.match(DEFAULT_INDEX_JS, /正文/);
  assert.match(DEFAULT_INDEX_JS, /讲清主题重点/);
  assert.match(DEFAULT_INDEX_JS, /列出章节顺序/);
  assert.match(DEFAULT_INDEX_JS, /展开重点动作/);
  assert.match(DEFAULT_INDEX_JS, /写清时间安排/);
  assert.match(DEFAULT_INDEX_JS, /发生了非预期换行/);
  assert.match(DEFAULT_INDEX_JS, /发生重叠/);
  assert.match(DEFAULT_INDEX_JS, /默认包含封面、目录和正文 3 页结构/);
});

test('DEFAULT_INDEX_JS keeps single-line sample text within the safe character budget', () => {
  const agendaSafeChars = recommendSingleLineChars(6.98, 48);
  const bodySideSafeChars = recommendSingleLineChars(5.16, 48);

  for (const text of [
    '讲清主题重点。',
    '列出章节顺序。',
    '展开重点动作。',
  ]) {
    assert.ok(text.length <= agendaSafeChars, `${text} should fit into the agenda description box`);
  }

  for (const text of [
    '先放关键结果。',
    '写清时间安排。',
  ]) {
    assert.ok(text.length <= bodySideSafeChars, `${text} should fit into the body side text box`);
    assert.ok(doesTextFitSingleLine(text, 5.16, 48), `${text} should pass the stricter single-line width check`);
  }
});
