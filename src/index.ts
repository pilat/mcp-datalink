#!/usr/bin/env node

/**
 * Entry point for mcp-datalink server
 *
 * Parses CLI arguments and starts the MCP server.
 */

import { parseArgs } from 'node:util';
import { loadConfig } from './config/loader.js';
import { runServer } from './server.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(`
mcp-datalink - MCP server for secure database access

Usage: mcp-datalink [options]

Options:
  -c, --config <path>  Path to config file (default: databases.json)
  -h, --help           Show this help message

Supported databases: PostgreSQL (MySQL, SQLite coming soon)
`);
    process.exit(0);
  }

  const config = await loadConfig(values.config);
  await runServer(config);
}

main().catch((error: Error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
