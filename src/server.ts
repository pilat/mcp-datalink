/**
 * MCP Server setup for db-mcp
 *
 * Creates and configures the MCP server with all database tools.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Config } from './types.js';
import { listDatabases } from './tools/list-databases.js';
import { listTables, type ListTablesParams } from './tools/list-tables.js';
import { describeTable, type DescribeTableParams } from './tools/describe-table.js';
import { query, type QueryParams, formatQueryResultAsMarkdown } from './tools/query.js';
import { execute, type ExecuteParams } from './tools/execute.js';
import { explain, type ExplainParams } from './tools/explain.js';
import { DbMcpError } from './utils/errors.js';

/**
 * Creates an MCP server configured with all db-mcp tools.
 *
 * @param config - Application configuration with database connections and defaults
 * @returns Configured MCP Server instance
 */
export function createServer(config: Config): Server {
  const server = new Server(
    {
      name: 'mcp-datalink',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_databases',
        description: 'List all configured database connections',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'list_tables',
        description: 'List tables in a database schema',
        inputSchema: {
          type: 'object' as const,
          properties: {
            database: { type: 'string', description: 'Database connection name' },
            schema: { type: 'string', description: 'Schema name (default: public)' },
          },
          required: ['database'],
        },
      },
      {
        name: 'describe_table',
        description: 'Get table structure including columns, indexes, and foreign keys',
        inputSchema: {
          type: 'object' as const,
          properties: {
            database: { type: 'string', description: 'Database connection name' },
            table: { type: 'string', description: 'Table name' },
            schema: { type: 'string', description: 'Schema name (default: public)' },
          },
          required: ['database', 'table'],
        },
      },
      {
        name: 'query',
        description: 'Execute a read-only SELECT query. Use $1, $2, ... placeholders for parameters.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            database: { type: 'string', description: 'Database connection name' },
            sql: { type: 'string', description: 'SQL SELECT query. Use $1, $2, ... for parameter placeholders' },
            params: { type: 'array', description: 'Parameter values in order ($1, $2, ...). Always use params instead of interpolating values into SQL.' },
          },
          required: ['database', 'sql'],
        },
      },
      {
        name: 'execute',
        description: 'Execute INSERT/UPDATE/DELETE query. Use $1, $2, ... placeholders for parameters.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            database: { type: 'string', description: 'Database connection name' },
            sql: { type: 'string', description: 'SQL INSERT/UPDATE/DELETE query. Use $1, $2, ... for parameter placeholders' },
            params: { type: 'array', description: 'Parameter values in order ($1, $2, ...). Always use params instead of interpolating values into SQL.' },
          },
          required: ['database', 'sql'],
        },
      },
      {
        name: 'explain',
        description: 'Show query execution plan',
        inputSchema: {
          type: 'object' as const,
          properties: {
            database: { type: 'string', description: 'Database connection name' },
            sql: { type: 'string', description: 'SQL query to explain' },
            analyze: { type: 'boolean', description: 'Run EXPLAIN ANALYZE (default: false)' },
          },
          required: ['database', 'sql'],
        },
      },
    ],
  }));

  // Register call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'list_databases':
          return {
            content: [{ type: 'text', text: JSON.stringify(listDatabases(config), null, 2) }],
          };
        case 'list_tables':
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  await listTables(args as unknown as ListTablesParams, config),
                  null,
                  2
                ),
              },
            ],
          };
        case 'describe_table':
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  await describeTable(args as unknown as DescribeTableParams, config),
                  null,
                  2
                ),
              },
            ],
          };
        case 'query': {
          const result = await query(args as unknown as QueryParams, config);
          return {
            content: [
              {
                type: 'text',
                text: formatQueryResultAsMarkdown(result),
              },
            ],
          };
        }
        case 'execute':
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  await execute(args as unknown as ExecuteParams, config),
                  null,
                  2
                ),
              },
            ],
          };
        case 'explain':
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  await explain(args as unknown as ExplainParams, config),
                  null,
                  2
                ),
              },
            ],
          };
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof DbMcpError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toJSON(), null, 2) }],
          isError: true,
        };
      }
      throw error;
    }
  });

  return server;
}

/**
 * Starts the MCP server with stdio transport.
 *
 * @param config - Application configuration
 */
export async function runServer(config: Config): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
