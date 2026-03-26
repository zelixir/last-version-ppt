import assert from 'node:assert/strict';
import test from 'node:test';

import { __systemFontTestUtils } from './system-fonts.ts';

const { extractFontLabelFromBuffer, sanitizeFontLabel } = __systemFontTestUtils;

function toUtf16Be(value: string): Buffer {
  const le = Buffer.from(value, 'utf16le');
  for (let i = 0; i < le.length; i += 2) {
    const tmp = le[i];
    le[i] = le[i + 1];
    le[i + 1] = tmp;
  }
  return le;
}

function buildNameTableBuffer(label: string, options?: { truncate?: boolean }): Buffer {
  const nameTableOffset = 32;
  const stringData = toUtf16Be(label);
  const stringOffset = 6 + 12; // header + one record
  const declaredNameTableLength = stringOffset + stringData.length - (options?.truncate ? Math.ceil(stringData.length / 2) : 0);
  const buffer = Buffer.alloc(nameTableOffset + stringOffset + stringData.length);

  buffer.writeUInt32BE(0x00010000, 0); // sfnt version
  buffer.writeUInt16BE(1, 4); // numTables

  const dirStart = 12;
  buffer.write('name', dirStart, 'ascii');
  buffer.writeUInt32BE(0, dirStart + 4); // checksum (ignored)
  buffer.writeUInt32BE(nameTableOffset, dirStart + 8);
  buffer.writeUInt32BE(declaredNameTableLength, dirStart + 12);

  buffer.writeUInt16BE(0, nameTableOffset); // format
  buffer.writeUInt16BE(1, nameTableOffset + 2); // count
  buffer.writeUInt16BE(stringOffset, nameTableOffset + 4); // stringOffset

  const recordOffset = nameTableOffset + 6;
  buffer.writeUInt16BE(3, recordOffset); // platformId (Windows)
  buffer.writeUInt16BE(1, recordOffset + 2); // encodingId (Unicode BMP)
  buffer.writeUInt16BE(0x0804, recordOffset + 4); // languageId (zh-CN)
  buffer.writeUInt16BE(4, recordOffset + 6); // nameId (full font name)
  buffer.writeUInt16BE(stringData.length, recordOffset + 8);
  buffer.writeUInt16BE(0, recordOffset + 10); // offset into string storage

  stringData.copy(buffer, nameTableOffset + stringOffset);
  return buffer;
}

test('extractFontLabelFromBuffer ignores strings outside the declared name table', () => {
  const buffer = buildNameTableBuffer('简洁测试字体 Regular', { truncate: true });
  assert.equal(extractFontLabelFromBuffer(buffer, 0), null);
});

test('extractFontLabelFromBuffer returns a cleaned UTF-16 label', () => {
  const buffer = buildNameTableBuffer('\u0001微软雅黑 Regular');
  assert.equal(extractFontLabelFromBuffer(buffer, 0), '微软雅黑 Regular');
});

test('sanitizeFontLabel removes control characters and empty outputs', () => {
  assert.equal(sanitizeFontLabel('\u0002  微软雅黑  \u0000 Regular'), '微软雅黑 Regular');
  assert.equal(sanitizeFontLabel('\u0000\u0001'), null);
});
