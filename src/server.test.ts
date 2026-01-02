/**
 * Tests for MCP server creation and tool routing
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createServer } from './server.js';
import type { Config } from './types.js';
import { DbMcpError, ErrorCode } from './utils/errors.js';

// Mock all tool modules
vi.mock('./tools/list-databases.js', () => ({
  listDatabases: vi.fn(),
}));

vi.mock('./tools/list-tables.js', () => ({
  listTables: vi.fn(),
}));

vi.mock('./tools/describe-table.js', () => ({
  describeTable: vi.fn(),
}));

vi.mock('./tools/query.js', () => ({
  query: vi.fn(),
  formatQueryResultAsMarkdown: vi.fn((result) => {
    // Simple mock that returns Markdown-formatted output
    const table = `| ${result.columns.join(' | ')} |\n| ${result.columns.map(() => '---').join(' | ')} |\n${result.rows.map((r: string[]) => `| ${r.join(' | ')} |`).join('\n')}`;
    return `${table}\n\n**Rows:** ${result.rowCount}`;
  }),
}));

vi.mock('./tools/execute.js', () => ({
  execute: vi.fn(),
}));

vi.mock('./tools/explain.js', () => ({
  explain: vi.fn(),
}));

// Import mocked functions for assertions
import { listDatabases } from './tools/list-databases.js';
import { listTables } from './tools/list-tables.js';
import { describeTable } from './tools/describe-table.js';
import { query } from './tools/query.js';
import { execute } from './tools/execute.js';
import { explain } from './tools/explain.js';

const mockListDatabases = listDatabases as Mock;
const mockListTables = listTables as Mock;
const mockDescribeTable = describeTable as Mock;
const mockQuery = query as Mock;
const mockExecute = execute as Mock;
const mockExplain = explain as Mock;

const testConfig: Config = {
  databases: {
    test_db: {
      url: 'postgresql://localhost/test',
      readonly: false,
    },
    readonly_db: {
      url: 'postgresql://localhost/readonly',
      readonly: true,
    },
  },
  defaults: {
    maxRows: 100,
    maxCellLength: 500,
    maxTotalSize: 65536,
    maxColumns: 50,
    maxTables: 200,
    maxIndexes: 20,
    timeout: 30000,
  },
};

/**
 * Helper to extract handlers from the server for testing.
 * The MCP SDK stores handlers in a Map keyed by string method names.
 */
function getServerHandlers(server: Server): {
  listTools: () => Promise<{ tools: Array<{ name: string; description: string; inputSchema: unknown }> }>;
  callTool: (name: string, args: unknown) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
} {
  // Access internal request handlers map (keyed by method string)
  const handlersMap = (server as unknown as { _requestHandlers: Map<string, unknown> })._requestHandlers;

  const listToolsHandler = handlersMap.get('tools/list') as ((req: unknown) => Promise<unknown>) | undefined;
  const callToolHandler = handlersMap.get('tools/call') as ((req: unknown) => Promise<unknown>) | undefined;

  if (!listToolsHandler || !callToolHandler) {
    throw new Error('Handlers not found in server');
  }

  return {
    listTools: async () => {
      return listToolsHandler({ method: 'tools/list' }) as Promise<{ tools: Array<{ name: string; description: string; inputSchema: unknown }> }>;
    },
    callTool: async (name: string, args: unknown) => {
      return callToolHandler({
        method: 'tools/call',
        params: { name, arguments: args },
      }) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
    },
  };
}

describe('createServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a Server instance', () => {
    const server = createServer(testConfig);
    expect(server).toBeInstanceOf(Server);
  });
});

describe('ListTools handler', () => {
  it('returns all 6 tools', async () => {
    const server = createServer(testConfig);
    const { listTools } = getServerHandlers(server);

    const result = await listTools();

    expect(result.tools).toHaveLength(6);
    expect(result.tools.map((t) => t.name)).toEqual([
      'list_databases',
      'list_tables',
      'describe_table',
      'query',
      'execute',
      'explain',
    ]);
  });

  it('includes correct input schemas for each tool', async () => {
    const server = createServer(testConfig);
    const { listTools } = getServerHandlers(server);

    const result = await listTools();

    const queryTool = result.tools.find((t) => t.name === 'query');
    expect(queryTool?.inputSchema).toEqual({
      type: 'object',
      properties: {
        database: { type: 'string', description: 'Database connection name' },
        sql: { type: 'string', description: 'SQL SELECT query. Use $1, $2, ... for parameter placeholders' },
        params: { type: 'array', description: 'Parameter values in order ($1, $2, ...). Always use params instead of interpolating values into SQL.' },
      },
      required: ['database', 'sql'],
    });
  });
});

describe('CallTool handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes list_databases to listDatabases handler', async () => {
    mockListDatabases.mockReturnValue({ databases: [{ name: 'test_db', readonly: false }] });

    const server = createServer(testConfig);
    const { callTool } = getServerHandlers(server);

    const result = await callTool('list_databases', {});

    expect(mockListDatabases).toHaveBeenCalledWith(testConfig);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      databases: [{ name: 'test_db', readonly: false }],
    });
  });

  it('routes list_tables to listTables handler', async () => {
    mockListTables.mockResolvedValue({ tables: [], truncated: false });

    const server = createServer(testConfig);
    const { callTool } = getServerHandlers(server);

    await callTool('list_tables', { database: 'test_db', schema: 'public' });

    expect(mockListTables).toHaveBeenCalledWith({ database: 'test_db', schema: 'public' }, testConfig);
  });

  it('routes describe_table to describeTable handler', async () => {
    mockDescribeTable.mockResolvedValue({
      table: 'users',
      schema: 'public',
      columns: [],
      indexes: [],
      foreignKeys: [],
      truncated: false,
    });

    const server = createServer(testConfig);
    const { callTool } = getServerHandlers(server);

    await callTool('describe_table', { database: 'test_db', table: 'users' });

    expect(mockDescribeTable).toHaveBeenCalledWith(
      { database: 'test_db', table: 'users' },
      testConfig
    );
  });

  it('routes query to query handler', async () => {
    mockQuery.mockResolvedValue({
      columns: ['id', 'name'],
      rows: [['1', 'Alice']],
      rowCount: 1,
      truncated: false,
      executionTime: 10,
    });

    const server = createServer(testConfig);
    const { callTool } = getServerHandlers(server);

    await callTool('query', { database: 'test_db', sql: 'SELECT * FROM users', params: [] });

    expect(mockQuery).toHaveBeenCalledWith(
      { database: 'test_db', sql: 'SELECT * FROM users', params: [] },
      testConfig
    );
  });

  it('routes execute to execute handler', async () => {
    mockExecute.mockResolvedValue({
      command: 'INSERT',
      rowsAffected: 1,
      executionTime: 5,
    });

    const server = createServer(testConfig);
    const { callTool } = getServerHandlers(server);

    await callTool('execute', {
      database: 'test_db',
      sql: "INSERT INTO users (name) VALUES ($1)",
      params: ['Bob'],
    });

    expect(mockExecute).toHaveBeenCalledWith(
      { database: 'test_db', sql: "INSERT INTO users (name) VALUES ($1)", params: ['Bob'] },
      testConfig
    );
  });

  it('routes explain to explain handler', async () => {
    mockExplain.mockResolvedValue({
      plan: 'Seq Scan on users',
      executionTime: 3,
    });

    const server = createServer(testConfig);
    const { callTool } = getServerHandlers(server);

    await callTool('explain', { database: 'test_db', sql: 'SELECT * FROM users', analyze: false });

    expect(mockExplain).toHaveBeenCalledWith(
      { database: 'test_db', sql: 'SELECT * FROM users', analyze: false },
      testConfig
    );
  });

  it('throws error for unknown tool', async () => {
    const server = createServer(testConfig);
    const { callTool } = getServerHandlers(server);

    await expect(callTool('unknown_tool', {})).rejects.toThrow('Unknown tool: unknown_tool');
  });
});

describe('Error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns isError: true for DbMcpError', async () => {
    const dbError = new DbMcpError(
      ErrorCode.DATABASE_NOT_FOUND,
      'Database "unknown" not found',
      { database: 'unknown' }
    );
    mockListTables.mockRejectedValue(dbError);

    const server = createServer(testConfig);
    const { callTool } = getServerHandlers(server);

    const result = await callTool('list_tables', { database: 'unknown' });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      name: 'DbMcpError',
      code: 'DATABASE_NOT_FOUND',
      message: 'Database "unknown" not found',
      details: { database: 'unknown' },
    });
  });

  it('re-throws non-DbMcpError errors', async () => {
    const genericError = new Error('Something went wrong');
    mockQuery.mockRejectedValue(genericError);

    const server = createServer(testConfig);
    const { callTool } = getServerHandlers(server);

    await expect(
      callTool('query', { database: 'test_db', sql: 'SELECT 1' })
    ).rejects.toThrow('Something went wrong');
  });
});
