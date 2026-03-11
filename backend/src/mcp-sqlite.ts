#!/usr/bin/env bun
/**
 * stdio MCP server for the local SQLite database (last-version-ppt.db).
 */

import { Database } from 'bun:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const DB_PATH = process.env.SQLITE_DB_PATH || 'last-version-ppt.db';
console.error(`${process.cwd()} - Starting SQLite MCP server with database: ${DB_PATH}`);
const db = new Database(DB_PATH, { create: true });

const server = new McpServer({
  name: 'last-version-ppt-sqlite',
  version: '1.0.0',
});

server.registerTool(
  'list_tables',
  {
    description: 'List all tables in the SQLite database',
    inputSchema: {},
    annotations: { title: 'List Tables', readOnlyHint: true, destructiveHint: false },
  },
  async () => {
    const rows = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
    const names = rows.map(row => row.name);
    return { content: [{ type: 'text' as const, text: names.length ? `Tables:\n${names.join('\n')}` : 'No tables found.' }] };
  }
);

server.registerTool(
  'describe_table',
  {
    description: 'Show the schema (columns) of a specific table',
    inputSchema: { table: z.string().describe('Name of the table to describe') },
    annotations: { title: 'Describe Table', readOnlyHint: true, destructiveHint: false },
  },
  async ({ table }) => {
    const exists = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
    if (!exists) {
      return { content: [{ type: 'text' as const, text: `Table \"${table}\" does not exist.` }], isError: true };
    }

    const safeName = table.replace(/[^a-zA-Z0-9_]/g, '');
    if (safeName !== table) {
      return {
        content: [{ type: 'text' as const, text: `Invalid table name \"${table}\". Only alphanumeric characters and underscores are allowed.` }],
        isError: true,
      };
    }

    // SQLite does not support parameter binding for PRAGMA table_info, so we
    // validate the identifier strictly above and interpolate the sanitized name here.
    const cols = db.query(`PRAGMA table_info(\"${safeName}\")`).all() as Array<{ cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
    const lines = cols.map(col => `  ${col.name} ${col.type}` + (col.pk ? ' PRIMARY KEY' : '') + (col.notnull ? ' NOT NULL' : '') + (col.dflt_value !== null ? ` DEFAULT ${col.dflt_value}` : ''));
    return { content: [{ type: 'text' as const, text: `CREATE TABLE ${table} (\n${lines.join(',\n')}\n)` }] };
  }
);

server.registerTool(
  'query',
  {
    description: 'Execute a read-only SQL SELECT query and return the results as JSON',
    inputSchema: {
      sql: z.string().describe('SQL SELECT statement to execute'),
      params: z.array(z.union([z.string(), z.number(), z.null()])).optional().describe('Optional positional parameters for the query'),
    },
    annotations: { title: 'SQL Query (read-only)', readOnlyHint: true, destructiveHint: false },
  },
  async ({ sql, params }) => {
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
      return {
        content: [{ type: 'text' as const, text: 'Only SELECT (or WITH ... SELECT) queries are allowed in the "query" tool. Use the "execute" tool for write operations.' }],
        isError: true,
      };
    }

    try {
      const rows = db.query(sql).all(...(params ?? []));
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Query error: ${message}` }], isError: true };
    }
  }
);

server.registerTool(
  'execute',
  {
    description: 'Execute a write SQL statement (INSERT, UPDATE, DELETE, etc.) and return the number of rows affected',
    inputSchema: {
      sql: z.string().describe('SQL statement to execute'),
      params: z.array(z.union([z.string(), z.number(), z.null()])).optional().describe('Optional positional parameters for the statement'),
    },
    annotations: { title: 'SQL Execute (write)', readOnlyHint: false, destructiveHint: true },
  },
  async ({ sql, params }) => {
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('SELECT')) {
      return { content: [{ type: 'text' as const, text: 'Use the "query" tool for SELECT statements.' }], isError: true };
    }

    try {
      const stmt = db.prepare(sql);
      const result = stmt.run(...(params ?? []));
      return { content: [{ type: 'text' as const, text: `OK - ${result.changes} row(s) affected. Last insert row id: ${result.lastInsertRowid}` }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Execute error: ${message}` }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[mcp-sqlite] Connected to database: ${DB_PATH}\n`);
}

main().catch(err => {
  process.stderr.write(`[mcp-sqlite] Fatal error: ${err}\n`);
  process.exit(1);
});
