#!/usr/bin/env node
import Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { databasePath, ensureStorageLayout } from './storage.ts';

ensureStorageLayout();
const DB_PATH = process.env.SQLITE_DB_PATH || databasePath;
console.error(`${process.cwd()} - Starting SQLite MCP server with database: ${DB_PATH}`);
const db = new Database(DB_PATH);

const server = new McpServer({ name: 'last-version-ppt-sqlite', version: '1.0.0' });

server.registerTool('list_tables', {
  description: 'List all tables in the SQLite database',
  inputSchema: {},
  annotations: { title: 'List Tables', readOnlyHint: true, destructiveHint: false },
}, async () => {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
  const names = rows.map(row => row.name);
  return { content: [{ type: 'text' as const, text: names.length ? `Tables:\n${names.join('\n')}` : 'No tables found.' }] };
});

server.registerTool('describe_table', {
  description: 'Show the schema (columns) of a specific table',
  inputSchema: { table: z.string().describe('Name of the table to describe') },
  annotations: { title: 'Describe Table', readOnlyHint: true, destructiveHint: false },
}, async ({ table }) => {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  if (!exists) return { content: [{ type: 'text' as const, text: `Table \"${table}\" does not exist.` }], isError: true };
  const safeName = table.replace(/[^a-zA-Z0-9_]/g, '');
  if (safeName !== table) {
    return { content: [{ type: 'text' as const, text: `Invalid table name \"${table}\".` }], isError: true };
  }
  const cols = db.prepare(`PRAGMA table_info("${safeName}")`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
  const lines = cols.map(col => `  ${col.name} ${col.type}` + (col.pk ? ' PRIMARY KEY' : '') + (col.notnull ? ' NOT NULL' : '') + (col.dflt_value !== null ? ` DEFAULT ${col.dflt_value}` : ''));
  return { content: [{ type: 'text' as const, text: `CREATE TABLE ${table} (\n${lines.join(',\n')}\n)` }] };
});

server.registerTool('query', {
  description: 'Execute a read-only SQL SELECT query and return the results as JSON',
  inputSchema: { sql: z.string(), params: z.array(z.union([z.string(), z.number(), z.null()])).optional() },
  annotations: { title: 'SQL Query (read-only)', readOnlyHint: true, destructiveHint: false },
}, async ({ sql, params }) => {
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    return { content: [{ type: 'text' as const, text: 'Only SELECT or WITH queries are allowed.' }], isError: true };
  }
  try {
    const rows = db.prepare(sql).all(...(params ?? []));
    return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: `Query error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
});

server.registerTool('execute', {
  description: 'Execute a write SQL statement (INSERT, UPDATE, DELETE, etc.) and return the number of rows affected',
  inputSchema: { sql: z.string(), params: z.array(z.union([z.string(), z.number(), z.null()])).optional() },
  annotations: { title: 'SQL Execute (write)', readOnlyHint: false, destructiveHint: true },
}, async ({ sql, params }) => {
  const trimmed = sql.trim().toUpperCase();
  if (trimmed.startsWith('SELECT')) {
    return { content: [{ type: 'text' as const, text: 'Use query for SELECT statements.' }], isError: true };
  }
  try {
    const result = db.prepare(sql).run(...(params ?? []));
    return { content: [{ type: 'text' as const, text: `OK - ${result.changes} row(s) affected. Last insert row id: ${result.lastInsertRowid}` }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: `Execute error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[mcp-sqlite] Connected to database: ${DB_PATH}\n`);
}

main().catch(error => {
  process.stderr.write(`[mcp-sqlite] Fatal error: ${error}\n`);
  process.exit(1);
});
