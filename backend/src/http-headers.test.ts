import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAttachmentDisposition } from './http-headers.ts';

test('buildAttachmentDisposition encodes non-ascii file names for downloads', () => {
  const header = buildAttachmentDisposition('20260312_季度运营复盘计划.pptx');
  assert.match(header, /^attachment; filename="/);
  assert.match(header, /filename\*=UTF-8''20260312_/);
  assert.doesNotMatch(header, /filename=".*季度运营复盘计划/);
});

test('buildAttachmentDisposition strips line breaks from file names', () => {
  const header = buildAttachmentDisposition('demo\r\nname.pptx');
  assert.doesNotMatch(header, /[\r\n]/);
  assert.match(header, /demo/);
});
