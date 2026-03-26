import assert from 'node:assert/strict';
import test from 'node:test';

import { __systemFontTestUtils } from './system-fonts.ts';

const {
  extractFontLabelFromBuffer,
  looksLikeGarbledFontLabel,
  normalizeWindowsRegistryFontLabel,
  parseWindowsRegistryFontQuery,
  sanitizeFontLabel,
} = __systemFontTestUtils;

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

function buildMultiRecordNameTableBuffer(records: Array<{ platformId: number; languageId: number; nameId: number; text: string; utf16be?: boolean }>): Buffer {
  const nameTableOffset = 32;
  const encodedRecords = records.map(record => ({
    ...record,
    data: record.utf16be === false ? Buffer.from(record.text, 'latin1') : toUtf16Be(record.text),
  }));
  const stringOffset = 6 + encodedRecords.length * 12;
  const stringDataLength = encodedRecords.reduce((total, record) => total + record.data.length, 0);
  const buffer = Buffer.alloc(nameTableOffset + stringOffset + stringDataLength);

  buffer.writeUInt32BE(0x00010000, 0);
  buffer.writeUInt16BE(1, 4);

  const dirStart = 12;
  buffer.write('name', dirStart, 'ascii');
  buffer.writeUInt32BE(0, dirStart + 4);
  buffer.writeUInt32BE(nameTableOffset, dirStart + 8);
  buffer.writeUInt32BE(stringOffset + stringDataLength, dirStart + 12);

  buffer.writeUInt16BE(0, nameTableOffset);
  buffer.writeUInt16BE(encodedRecords.length, nameTableOffset + 2);
  buffer.writeUInt16BE(stringOffset, nameTableOffset + 4);

  let currentOffset = 0;
  for (const [index, record] of encodedRecords.entries()) {
    const recordOffset = nameTableOffset + 6 + index * 12;
    buffer.writeUInt16BE(record.platformId, recordOffset);
    buffer.writeUInt16BE(record.platformId === 1 ? 0 : 1, recordOffset + 2);
    buffer.writeUInt16BE(record.languageId, recordOffset + 4);
    buffer.writeUInt16BE(record.nameId, recordOffset + 6);
    buffer.writeUInt16BE(record.data.length, recordOffset + 8);
    buffer.writeUInt16BE(currentOffset, recordOffset + 10);
    record.data.copy(buffer, nameTableOffset + stringOffset + currentOffset);
    currentOffset += record.data.length;
  }

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

test('extractFontLabelFromBuffer prefers Windows Unicode names over garbled Macintosh records', () => {
  const buffer = buildMultiRecordNameTableBuffer([
    { platformId: 1, languageId: 0, nameId: 4, text: ', < 6 T . b 6 * L J F T 8 R X $ - " R 0 T * *', utf16be: false },
    { platformId: 3, languageId: 0, nameId: 4, text: '微软雅黑 Regular' },
  ]);
  assert.equal(extractFontLabelFromBuffer(buffer, 0), '微软雅黑 Regular');
});

test('sanitizeFontLabel rejects spaced-out garbled names', () => {
  assert.equal(looksLikeGarbledFontLabel(', < 6 T . b 6 * L J F T 8 R X $ - " R 0 T * * L J F T 8 N o r m a l'), true);
  assert.equal(sanitizeFontLabel(', < 6 T . b 6 * L J F T 8 R X $ - " R 0 T * * L J F T 8 N o r m a l'), null);
});

test('normalizeWindowsRegistryFontLabel strips registry suffixes', () => {
  assert.equal(normalizeWindowsRegistryFontLabel('微软雅黑 (TrueType)'), '微软雅黑');
  assert.equal(normalizeWindowsRegistryFontLabel('思源黑体 (OpenType)'), '思源黑体');
  assert.equal(normalizeWindowsRegistryFontLabel(''), null);
});

test('parseWindowsRegistryFontQuery maps registry font entries to known font paths', () => {
  const output = [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    '    微软雅黑 (TrueType)    REG_SZ    msyh.ttc',
    '    Segoe UI Bold (TrueType)    REG_SZ    C:\\\\Users\\\\demo\\\\AppData\\\\Local\\\\Microsoft\\\\Windows\\\\Fonts\\\\segoeuib.ttf',
    '',
  ].join('\n');

  const labels = parseWindowsRegistryFontQuery(output, ['C:\\Windows\\Fonts']);

  assert.equal(labels['c:\\windows\\fonts\\msyh.ttc'], '微软雅黑');
  assert.equal(
    labels['c:\\users\\demo\\appdata\\local\\microsoft\\windows\\fonts\\segoeuib.ttf'],
    'Segoe UI Bold',
  );
});
