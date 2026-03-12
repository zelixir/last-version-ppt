function toAsciiFallbackFileName(fileName: string): string {
  const cleaned = fileName
    .normalize('NFKD')
    .replace(/[\r\n]+/g, '')
    .replace(/[^\x20-\x7E]+/g, '-')
    .replace(/["\\;]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const collapsed = cleaned
    .replace(/-+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return collapsed || 'download';
}

function encodeExtendedFileName(fileName: string): string {
  return encodeURIComponent(fileName)
    .replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function buildAttachmentDisposition(fileName: string): string {
  const safeFileName = fileName.replace(/[\r\n]+/g, '').trim() || 'download';
  return `attachment; filename="${toAsciiFallbackFileName(safeFileName)}"; filename*=UTF-8''${encodeExtendedFileName(safeFileName)}`;
}
