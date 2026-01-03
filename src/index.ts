#!/usr/bin/env node

/**
 * Entry point for mcp-datalink server
 */

import { parseArgs } from 'node:util';
import { loadConfig } from './config/loader.js';
import { runServer } from './server.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(`
mcp-datalink - MCP server for secure database access

Usage: mcp-datalink

Configuration via environment variables:
  DATALINK_{NAME}_URL       Database connection URL
  DATALINK_{NAME}_READONLY  Set to "true" for read-only mode

Example:
  DATALINK_PROD_URL=postgresql://user:pass@host:5432/db
  DATALINK_PROD_READONLY=true

Supported databases: PostgreSQL, MySQL, SQLite
`);
    process.exit(0);
  }

  const config = loadConfig();
  await runServer(config);
}

main().catch((error: Error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
