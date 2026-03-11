import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

function formatDate(now = new Date()) {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function sanitizeSegment(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 40);
}

export function getStorageRoot() {
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'last-version-ppt');
  }

  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'last-version-ppt');
  }

  return path.join(os.homedir(), '.config', 'last-version-ppt');
}

export function createProjectFolderName(topic, now = new Date()) {
  const slug = sanitizeSegment(topic) || 'project';
  return `${formatDate(now)}_${slug}`;
}

export async function ensureStorageRoot() {
  const storageRoot = getStorageRoot();
  await fs.mkdir(storageRoot, { recursive: true });
  return storageRoot;
}

export async function createProjectDirectory(topic, now = new Date()) {
  const storageRoot = await ensureStorageRoot();
  const baseName = createProjectFolderName(topic, now);
  let candidate = path.join(storageRoot, baseName);
  let index = 1;

  while (true) {
    try {
      await fs.mkdir(candidate);
      return {
        storageRoot,
        folderName: path.basename(candidate),
        projectDir: candidate,
      };
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        index += 1;
        candidate = path.join(storageRoot, `${baseName}-${index}`);
        continue;
      }

      throw error;
    }
  }
}

export function getSettingsPath(storageRoot = getStorageRoot()) {
  return path.join(storageRoot, 'settings.json');
}
