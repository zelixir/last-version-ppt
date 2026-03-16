import assert from 'node:assert/strict';
import test from 'node:test';

import { getProjectRecordSyncDiff } from './project-record-sync.ts';

test('getProjectRecordSyncDiff reports missing and stale project ids', () => {
  assert.deepEqual(
    getProjectRecordSyncDiff(
      ['20260316_封面示例', '20260316_目录示例'],
      ['20260316_目录示例', '20260316_失效项目'],
    ),
    {
      missingRecordIds: ['20260316_封面示例'],
      staleRecordIds: ['20260316_失效项目'],
    },
  );
});
