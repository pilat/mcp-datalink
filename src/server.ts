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
 * Server instructions for LLM agents.
 * Provides workflow guidance for proper tool usage sequence.
 */
const SERVER_INSTRUCTIONS = `Database Query Workflow:
1. Discovery: Use list_databases to find available database connections.
2. Exploration: Use list_tables to discover tables in a database schema.
3. Schema Validation: Always call describe_table before writing queries to verify exact column names, types, and constraints. Never assume or guess column names.
4. Query Execution: Use query for SELECT statements, execute for INSERT/UPDATE/DELETE.
5. Security: All queries must use parameterized placeholders ($1, $2, ...). Never interpolate values directly into SQL strings.
6. Performance: Use explain to analyze query execution plans for optimization.

The recommended sequence is: list_databases → list_tables → describe_table → query/execute.
Skipping describe_table often leads to errors due to incorrect column names or types.`;

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
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // Register list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_databases',
        description:
          'List all configured database connections available in this server.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'list_tables',
        description:
          'List all tables and views in a database schema with row counts and metadata.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            database: {
              type: 'string',
              description: 'Database connection name as returned by list_databases',
            },
            schema: {
              type: 'string',
              description: 'Schema name to list tables from (default: public for PostgreSQL, none for SQLite)',
            },
          },
          required: ['database'],
        },
      },
      {
        name: 'describe_table',
        description:
          'Retrieve detailed table structure: column names, data types, nullability, defaults, indexes, and foreign key relationships.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            database: {
              type: 'string',
              description: 'Database connection name as returned by list_databases',
            },
            table: {
              type: 'string',
              description: 'Table name as returned by list_tables',
            },
            schema: {
              type: 'string',
              description: 'Schema name (default: public for PostgreSQL)',
            },
          },
          required: ['database', 'table'],
        },
      },
      {
        name: 'query',
        description:
          'Execute a read-only SELECT query and return results as structured data.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            database: {
              type: 'string',
              description: 'Database connection name as returned by list_databases',
            },
            sql: {
              type: 'string',
              description:
                'SELECT query using parameterized placeholders ($1, $2, ...) for values. ' +
                'Example: SELECT * FROM users WHERE status = $1 AND created_at > $2',
            },
            params: {
              type: 'array',
              description:
                'Parameter values corresponding to placeholders in order. ' +
                'Example: ["active", "2024-01-01"] for $1 and $2',
            },
          },
          required: ['database', 'sql'],
        },
      },
      {
        name: 'execute',
        description:
          'Execute INSERT, UPDATE, or DELETE query and return affected row count.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            database: {
              type: 'string',
              description: 'Database connection name as returned by list_databases',
            },
            sql: {
              type: 'string',
              description:
                'INSERT/UPDATE/DELETE query using parameterized placeholders ($1, $2, ...). ' +
                'Example: UPDATE users SET status = $1 WHERE id = $2',
            },
            params: {
              type: 'array',
              description:
                'Parameter values corresponding to placeholders in order. ' +
                'Example: ["inactive", 123] for $1 and $2',
            },
          },
          required: ['database', 'sql'],
        },
      },
      {
        name: 'explain',
        description:
          'Analyze query execution plan to understand performance characteristics and identify optimization opportunities.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            database: {
              type: 'string',
              description: 'Database connection name as returned by list_databases',
            },
            sql: {
              type: 'string',
              description: 'SQL query to analyze (typically a SELECT statement)',
            },
            analyze: {
              type: 'boolean',
              description:
                'If true, actually execute the query to get real timing statistics (EXPLAIN ANALYZE). ' +
                'If false, show estimated plan only. Default: false',
            },
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
