import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { resolve, join } from 'path';
import type { Config, DatabaseConfig, DefaultsConfig, RawConfig } from '../types.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';

const DEFAULT_CONFIG: DefaultsConfig = {
  maxRows: 100,
  maxCellLength: 500,
  maxTotalSize: 65536, // 64KB
  maxColumns: 50,
  maxTables: 200,
  maxIndexes: 20,
  timeout: 30000,
};

/**
 * Try to read and parse a JSON config file.
 * Returns null if file doesn't exist.
 */
async function tryReadConfigFile(path: string): Promise<RawConfig | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as RawConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new DbMcpError(
      ErrorCode.CONFIG_INVALID,
      `Failed to parse config file ${path}: ${(err as Error).message}`
    );
  }
}

/**
 * Resolve ${ENV_VAR} placeholders in a string.
 */
function resolveEnvPlaceholders(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar: string) => {
    const envValue = process.env[envVar];
    if (envValue === undefined) {
      throw new DbMcpError(
        ErrorCode.CONFIG_INVALID,
        `Environment variable ${envVar} is not defined`
      );
    }
    return envValue;
  });
}

/**
 * Extract databases from DB_MCP_{NAME}_URL environment variables.
 */
function getDatabasesFromEnv(): Record<string, DatabaseConfig> {
  const databases: Record<string, DatabaseConfig> = {};
  const pattern = /^DB_MCP_([A-Z0-9_]+)_URL$/;

  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(pattern);
    if (match && value) {
      const name = match[1].toLowerCase();
      databases[name] = {
        url: value,
        readonly: false,
      };
    }
  }

  return databases;
}

/**
 * Load configuration with resolution priority:
 * 1. CLI argument: --config ./path/to/config.json
 * 2. Environment variable: DB_MCP_CONFIG
 * 3. Current directory: ./databases.json
 * 4. Home directory: ~/.config/db-mcp/databases.json
 * 5. ENV-only mode: DB_MCP_{NAME}_URL variables
 */
export async function loadConfig(cliConfigPath?: string): Promise<Config> {
  let rawConfig: RawConfig | null = null;

  // 1. CLI argument
  if (cliConfigPath) {
    const resolvedPath = resolve(cliConfigPath);
    rawConfig = await tryReadConfigFile(resolvedPath);
    if (!rawConfig) {
      throw new DbMcpError(
        ErrorCode.CONFIG_NOT_FOUND,
        `Config file not found: ${resolvedPath}`
      );
    }
  }

  // 2. Environment variable
  if (!rawConfig && process.env.DB_MCP_CONFIG) {
    const envPath = resolve(process.env.DB_MCP_CONFIG);
    rawConfig = await tryReadConfigFile(envPath);
    if (!rawConfig) {
      throw new DbMcpError(
        ErrorCode.CONFIG_NOT_FOUND,
        `Config file not found: ${envPath}`
      );
    }
  }

  // 3. Current directory
  if (!rawConfig) {
    rawConfig = await tryReadConfigFile(resolve('./databases.json'));
  }

  // 4. Home directory
  if (!rawConfig) {
    const homePath = join(homedir(), '.config', 'db-mcp', 'databases.json');
    rawConfig = await tryReadConfigFile(homePath);
  }

  // 5. ENV-only mode
  const envDatabases = getDatabasesFromEnv();

  // Build final config
  const databases: Record<string, DatabaseConfig> = {};

  // Add databases from config file (with env placeholder resolution)
  if (rawConfig?.databases) {
    for (const [name, dbConfig] of Object.entries(rawConfig.databases)) {
      databases[name] = {
        url: resolveEnvPlaceholders(dbConfig.url),
        readonly: dbConfig.readonly ?? false,
        maxRows: dbConfig.maxRows,
      };
    }
  }

  // Add databases from environment (ENV-only mode)
  // These don't override config file databases
  for (const [name, dbConfig] of Object.entries(envDatabases)) {
    if (!(name in databases)) {
      databases[name] = dbConfig;
    }
  }

  // Validate at least one database is configured
  if (Object.keys(databases).length === 0) {
    throw new DbMcpError(
      ErrorCode.CONFIG_NOT_FOUND,
      'No databases configured. Provide a config file or set DB_MCP_{NAME}_URL environment variables.'
    );
  }

  // Merge defaults
  const defaults: DefaultsConfig = {
    ...DEFAULT_CONFIG,
    ...rawConfig?.defaults,
  };

  return { databases, defaults };
}
