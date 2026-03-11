import { Database } from 'bun:sqlite';
import { databasePath, ensureStorageLayout } from './storage.ts';

ensureStorageLayout();

const db = new Database(databasePath);
db.exec('PRAGMA journal_mode = WAL');

function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      label TEXT,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      display_name TEXT,
      provider TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '{}',
      enabled TEXT NOT NULL DEFAULT 'Y'
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_project_id TEXT NOT NULL,
      source_prompt TEXT NOT NULL DEFAULT '',
      chat_history TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const projectColumns = db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>;
  const projectColumnNames = new Set(projectColumns.map(column => column.name));
  if (!projectColumnNames.has('root_project_id')) {
    db.exec(`ALTER TABLE projects ADD COLUMN root_project_id TEXT NOT NULL DEFAULT ''`);
    db.exec(`UPDATE projects SET root_project_id = id WHERE root_project_id = ''`);
  }
  if (!projectColumnNames.has('source_prompt')) {
    db.exec(`ALTER TABLE projects ADD COLUMN source_prompt TEXT NOT NULL DEFAULT ''`);
  }
  if (!projectColumnNames.has('chat_history')) {
    db.exec(`ALTER TABLE projects ADD COLUMN chat_history TEXT NOT NULL DEFAULT '[]'`);
  }
}

runMigrations();

export { db };

export interface AiModelCapabilities {
  multimodal?: boolean;
  deep_thinking?: boolean;
  tool_calling?: boolean;
  function_calling?: boolean;
  [key: string]: boolean | undefined;
}

export interface AiModel {
  id: number;
  model_name: string;
  display_name: string;
  provider: string;
  capabilities: AiModelCapabilities;
  enabled: 'Y' | 'N';
}

function parseAiModel(row: any): AiModel {
  return {
    ...row,
    display_name: row.display_name || row.model_name,
    capabilities: typeof row.capabilities === 'string' ? JSON.parse(row.capabilities) : row.capabilities,
  };
}

export function getAiModels(enabledOnly = false): AiModel[] {
  const rows = enabledOnly
    ? (db.prepare("SELECT * FROM ai_models WHERE enabled = 'Y' ORDER BY id").all() as any[])
    : (db.prepare('SELECT * FROM ai_models ORDER BY id').all() as any[]);
  return rows.map(parseAiModel);
}

export function getAiModelById(id: number): AiModel | null {
  const row = db.prepare('SELECT * FROM ai_models WHERE id = ?').get(id) as any;
  return row ? parseAiModel(row) : null;
}

export function createAiModel(data: { model_name: string; display_name?: string; provider: string; capabilities?: AiModelCapabilities; enabled?: 'Y' | 'N' }): AiModel {
  const display_name = data.display_name ?? data.model_name;
  const capabilities = JSON.stringify(data.capabilities || {});
  const enabled = data.enabled ?? 'Y';
  const result = db.prepare('INSERT INTO ai_models (model_name, display_name, provider, capabilities, enabled) VALUES (?, ?, ?, ?, ?)').run(
    data.model_name,
    display_name,
    data.provider,
    capabilities,
    enabled,
  );
  return { id: Number(result.lastInsertRowid), model_name: data.model_name, display_name, provider: data.provider, capabilities: data.capabilities || {}, enabled };
}

export function updateAiModel(id: number, data: { model_name?: string; display_name?: string; provider?: string; capabilities?: AiModelCapabilities; enabled?: 'Y' | 'N' }): void {
  const current = getAiModelById(id);
  if (!current) return;
  db.prepare('UPDATE ai_models SET model_name = ?, display_name = ?, provider = ?, capabilities = ?, enabled = ? WHERE id = ?').run(
    data.model_name ?? current.model_name,
    data.display_name ?? current.display_name,
    data.provider ?? current.provider,
    JSON.stringify(data.capabilities ?? current.capabilities),
    data.enabled ?? current.enabled,
    id,
  );
}

export function deleteAiModel(id: number): void {
  db.prepare('DELETE FROM ai_models WHERE id = ?').run(id);
}

export function seedModelsFromJson(jsonContentOrData: string | object): void {
  const count = db.prepare('SELECT COUNT(*) as n FROM ai_models').get() as { n: number };
  if (count?.n > 0) return;

  const data = typeof jsonContentOrData === 'string' ? JSON.parse(jsonContentOrData) : jsonContentOrData;
  const providers: Array<{ name: string; models?: any[] }> = (data as any).providers || [];
  for (const provider of providers) {
    for (const model of provider.models || []) {
      createAiModel({
        model_name: model.model_name,
        display_name: model.display_name,
        provider: provider.name,
        capabilities: model.capabilities || {},
        enabled: model.enabled ?? 'Y',
      });
    }
  }
}

export interface ProviderRow {
  id: number;
  name: string;
  label?: string;
  base_url: string;
  api_key: string;
  created_at: string;
}

export function getProviders(): ProviderRow[] {
  return db.prepare('SELECT * FROM providers ORDER BY id').all() as ProviderRow[];
}

export function getProviderByName(name: string): ProviderRow | null {
  return (db.prepare('SELECT * FROM providers WHERE name = ?').get(name) as ProviderRow | null) ?? null;
}

export function createProvider(data: { name: string; label?: string; base_url: string; api_key: string }): ProviderRow {
  const result = db.prepare('INSERT INTO providers (name, label, base_url, api_key) VALUES (?, ?, ?, ?)').run(
    data.name,
    data.label || null,
    data.base_url,
    data.api_key,
  );
  return db.prepare('SELECT * FROM providers WHERE id = ?').get(Number(result.lastInsertRowid)) as ProviderRow;
}

export function updateProvider(name: string, data: { name?: string; label?: string; base_url?: string; api_key?: string }): void {
  const current = getProviderByName(name);
  if (!current) return;
  db.prepare('UPDATE providers SET name = ?, label = ?, base_url = ?, api_key = ? WHERE name = ?').run(
    data.name ?? current.name,
    data.label !== undefined ? data.label : (current.label ?? null),
    data.base_url ?? current.base_url,
    data.api_key ?? current.api_key,
    name,
  );
}

export function deleteProvider(name: string): void {
  db.prepare('DELETE FROM providers WHERE name = ?').run(name);
}

export function seedProvidersFromJson(jsonContentOrData: string | object): void {
  const count = db.prepare('SELECT COUNT(*) as n FROM providers').get() as { n: number };
  if (count?.n > 0) return;

  const data = typeof jsonContentOrData === 'string' ? JSON.parse(jsonContentOrData) : jsonContentOrData;
  for (const provider of (data as any).providers || []) {
    createProvider({
      name: provider.name,
      label: provider.label,
      base_url: provider.base_url,
      api_key: provider.api_key,
    });
  }
}

export interface ProjectChatToolEvent {
  toolName: string;
  summary: string;
  success: boolean;
}

export interface ProjectChatTextPart {
  type: 'text';
  text: string;
}

export interface ProjectChatToolPart extends ProjectChatToolEvent {
  type: 'tool';
  state?: 'running' | 'done';
}

export type ProjectChatMessagePart = ProjectChatTextPart | ProjectChatToolPart;

export interface ProjectChatEntry {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  toolEvents?: ProjectChatToolEvent[];
  parts?: ProjectChatMessagePart[];
}

export interface ProjectRecord {
  id: string;
  name: string;
  root_project_id: string;
  source_prompt: string;
  chat_history: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  rootProjectId: string;
  sourcePrompt: string;
  chatHistory: ProjectChatEntry[];
  createdAt: string;
  updatedAt: string;
}

function parseProject(row: ProjectRecord): ProjectRow {
  let chatHistory: ProjectChatEntry[] = [];
  try {
    chatHistory = JSON.parse(row.chat_history || '[]');
    if (!Array.isArray(chatHistory)) chatHistory = [];
  } catch {
    chatHistory = [];
  }

  return {
    id: row.id,
    name: row.name,
    rootProjectId: row.root_project_id || row.id,
    sourcePrompt: row.source_prompt || '',
    chatHistory,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProjects(): ProjectRow[] {
  return (db.prepare('SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC').all() as ProjectRecord[]).map(parseProject);
}

export function getProjectById(id: string): ProjectRow | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRecord | undefined;
  return row ? parseProject(row) : null;
}

export function createProjectRecord(data: { id: string; name: string; rootProjectId?: string; sourcePrompt?: string; chatHistory?: ProjectChatEntry[] }): ProjectRow {
  db.prepare('INSERT INTO projects (id, name, root_project_id, source_prompt, chat_history) VALUES (?, ?, ?, ?, ?)').run(
    data.id,
    data.name,
    data.rootProjectId ?? data.id,
    data.sourcePrompt ?? '',
    JSON.stringify(data.chatHistory ?? []),
  );
  return getProjectById(data.id)!;
}

export function updateProjectRecord(id: string, data: { name?: string; sourcePrompt?: string; chatHistory?: ProjectChatEntry[]; touch?: boolean }): ProjectRow | null {
  const current = getProjectById(id);
  if (!current) return null;
  db.prepare(`
    UPDATE projects
    SET name = ?,
        source_prompt = ?,
        chat_history = ?,
        updated_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE updated_at END
    WHERE id = ?
  `).run(
    data.name ?? current.name,
    data.sourcePrompt ?? current.sourcePrompt,
    JSON.stringify(data.chatHistory ?? current.chatHistory),
    data.touch === false ? 0 : 1,
    id,
  );
  return getProjectById(id);
}

export function appendProjectChat(id: string, entries: ProjectChatEntry[]): ProjectRow | null {
  const current = getProjectById(id);
  if (!current) return null;
  return updateProjectRecord(id, { chatHistory: [...current.chatHistory, ...entries], touch: true });
}

export function renameProjectRecord(id: string, nextId: string, nextName?: string): ProjectRow | null {
  const current = getProjectById(id);
  if (!current) return null;

  db.transaction(() => {
    db.prepare(`
      UPDATE projects
      SET id = ?,
          name = ?,
          root_project_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextId,
      nextName ?? current.name,
      current.rootProjectId === current.id ? nextId : current.rootProjectId,
      id,
    );

    if (current.rootProjectId === current.id) {
      db.prepare(`
        UPDATE projects
        SET root_project_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE root_project_id = ? AND id <> ?
      `).run(nextId, id, nextId);
    }

    const activeProjectId = getSetting('currentProjectId');
    if (activeProjectId === id) {
      setSetting('currentProjectId', nextId);
    }
  })();

  return getProjectById(nextId);
}

export function deleteProjectRecord(id: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function setSetting(key: string, value: string): void {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
