import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProjectDirectory, createProjectFolderName, getStorageRoot } from '../backend/src/paths.js';
import { extractJsonObject } from '../backend/src/ai.js';

test('getStorageRoot prefers APPDATA and app name', () => {
  const original = process.env.APPDATA;
  process.env.APPDATA = 'C:\\Users\\demo\\AppData\\Roaming';

  try {
    assert.equal(getStorageRoot(), path.join(process.env.APPDATA, 'last-version-ppt'));
  } finally {
    process.env.APPDATA = original;
  }
});

test('project folder names follow yyyyMMdd_ prefix rule', () => {
  const folderName = createProjectFolderName('2026 产品规划汇报', new Date('2026-03-11T00:00:00Z'));
  assert.match(folderName, /^20260311_/);
});

test('createProjectDirectory keeps unique folders under storage root', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'last-version-ppt-'));
  const original = process.env.APPDATA;
  process.env.APPDATA = tempRoot;

  try {
    const first = await createProjectDirectory('Roadmap', new Date('2026-03-11T00:00:00Z'));
    const second = await createProjectDirectory('Roadmap', new Date('2026-03-11T00:00:00Z'));

    assert.equal(first.folderName, '20260311_roadmap');
    assert.equal(second.folderName, '20260311_roadmap-2');
    assert.equal(path.dirname(first.projectDir), path.join(tempRoot, 'last-version-ppt'));
  } finally {
    process.env.APPDATA = original;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('extractJsonObject supports fenced JSON content', () => {
  const payload = extractJsonObject('```json\n{"title":"Demo","slides":[{"title":"A","bullets":["B"]}]}\n```');
  assert.equal(payload.title, 'Demo');
  assert.equal(payload.slides[0].title, 'A');
});
