import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateOutline } from './ai.js';
import { createProjectDirectory, ensureStorageRoot, getSettingsPath, getStorageRoot } from './paths.js';
import { writePresentation } from './ppt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, '../../frontend');
const storageRoot = getStorageRoot();
const settingsPath = getSettingsPath(storageRoot);
const port = Number(process.env.PORT || 3000);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error('请求体过大');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

function safeProjectSegment(value) {
  return typeof value === 'string' && value === path.basename(value) && !value.includes('..');
}

async function serveFile(response, filePath, contentType) {
  const stream = createReadStream(filePath);
  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  stream.pipe(response);
}

async function loadSettings() {
  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function saveSettings(settings) {
  await ensureStorageRoot();
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);

    if (request.method === 'GET' && requestUrl.pathname === '/api/settings') {
      const settings = await loadSettings();
      return sendJson(response, 200, {
        provider: {
          baseUrl: settings.provider?.baseUrl || '',
          model: settings.provider?.model || '',
        },
        storageRoot,
      });
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/generate') {
      const payload = await readJsonBody(request);
      const provider = {
        baseUrl: String(payload?.provider?.baseUrl || '').trim(),
        apiKey: String(payload?.provider?.apiKey || '').trim(),
        model: String(payload?.provider?.model || '').trim(),
      };
      const topic = String(payload?.topic || '').trim();
      const instructions = String(payload?.instructions || '').trim();

      if (!topic) {
        return sendJson(response, 400, { error: '请输入 PPT 主题' });
      }

      await saveSettings({
        provider: {
          baseUrl: provider.baseUrl,
          model: provider.model,
        },
      });

      const project = await createProjectDirectory(topic);
      const outline = await generateOutline({ ...provider, topic, instructions });
      await fs.writeFile(path.join(project.projectDir, 'outline.json'), JSON.stringify(outline, null, 2), 'utf-8');
      const pptFile = await writePresentation({ outline, projectDir: project.projectDir });

      return sendJson(response, 200, {
        title: outline.title,
        projectFolder: project.folderName,
        projectDir: project.projectDir,
        fileName: pptFile.fileName,
        downloadUrl: `/api/projects/${encodeURIComponent(project.folderName)}/files/${encodeURIComponent(pptFile.fileName)}`,
      });
    }

    const downloadMatch = requestUrl.pathname.match(/^\/api\/projects\/([^/]+)\/files\/([^/]+)$/);
    if (request.method === 'GET' && downloadMatch) {
      const [, folderName, fileName] = downloadMatch.map(decodeURIComponent);
      if (!safeProjectSegment(folderName) || !safeProjectSegment(fileName)) {
        return sendJson(response, 400, { error: '非法文件路径' });
      }

      const filePath = path.join(storageRoot, folderName, fileName);
      return serveFile(response, filePath, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    }

    if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html')) {
      return serveFile(response, path.join(frontendDir, 'index.html'), 'text/html; charset=utf-8');
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器错误';
    sendJson(response, 500, { error: message });
  }
});

server.listen(port, async () => {
  await ensureStorageRoot();
  console.log(`last-version-ppt running at http://127.0.0.1:${port}`);
  console.log(`storage root: ${storageRoot}`);
});
