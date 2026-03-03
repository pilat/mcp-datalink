/**
 * Integration test setup utilities
 *
 * Manages PostgreSQL and MySQL Docker containers using Testcontainers, and SQLite file database for integration tests.
 */

import pg from 'pg';
import * as mysql from 'mysql2/promise';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';

const TEST_SQLITE_DB_PATH = './test-data/test.db';

// Global container instances (set during startContainers)
let postgresContainer: StartedPostgreSqlContainer | null = null;
let mysqlContainer: StartedMySqlContainer | null = null;

// Connection strings (set dynamically after containers start)
let TEST_PG_URL: string;
let TEST_MYSQL_URL: string;

/**
 * Start the test containers (PostgreSQL and MySQL) using Testcontainers
 */
export async function startContainers(): Promise<void> {
  if (postgresContainer && mysqlContainer) {
    console.log('Test containers already running');
    return;
  }

  console.log('Starting PostgreSQL container...');
  postgresContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('test_db')
    .withUsername('test_user')
    .withPassword('test_password')
    .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
    .start();

  TEST_PG_URL = postgresContainer.getConnectionUri();
  // Store in environment variable so test files can access it
  process.env.TEST_POSTGRES_URL = TEST_PG_URL;
  console.log(`PostgreSQL ready on port ${postgresContainer.getPort()}`);

  console.log('Starting MySQL container...');
  mysqlContainer = await new MySqlContainer('mysql:8.0')
    .withDatabase('test_db')
    .withUsername('test_user')
    .withUserPassword('test_password')
    .withRootPassword('root_password')
    .withTmpFs({ '/var/lib/mysql': 'rw' })
    .start();

  TEST_MYSQL_URL = mysqlContainer.getConnectionUri();
  // Store in environment variable so test files can access it
  process.env.TEST_MYSQL_URL = TEST_MYSQL_URL;
  console.log(`MySQL ready on port ${mysqlContainer.getPort()}`);
}

/**
 * Start the test PostgreSQL container (backward compatibility)
 */
export async function startPostgres(): Promise<void> {
  await startContainers();
}

/**
 * Stop the test containers
 */
export async function stopContainers(): Promise<void> {
  console.log('Stopping test containers...');

  if (postgresContainer) {
    await postgresContainer.stop();
    postgresContainer = null;
  }

  if (mysqlContainer) {
    await mysqlContainer.stop();
    mysqlContainer = null;
  }

  console.log('Test containers stopped');
}

/**
 * Stop the test PostgreSQL container (backward compatibility)
 */
export async function stopPostgres(): Promise<void> {
  await stopContainers();
}

/**
 * Get the PostgreSQL connection URL (set after containers start)
 */
export function getPostgresUrl(): string {
  // Read from environment variable (set by global-setup)
  const url = process.env.TEST_POSTGRES_URL || TEST_PG_URL;
  if (!url) {
    throw new Error('PostgreSQL container not started yet');
  }
  return url;
}

/**
 * Get the MySQL connection URL (set after containers start)
 */
export function getMySqlUrl(): string {
  // Read from environment variable (set by global-setup)
  const url = process.env.TEST_MYSQL_URL || TEST_MYSQL_URL;
  if (!url) {
    throw new Error('MySQL container not started yet');
  }
  return url;
}

/**
 * Get a direct PostgreSQL database client for test verification
 */
export async function getTestClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: getPostgresUrl() });
  await client.connect();
  return client;
}

/**
 * Execute SQL directly for test setup/verification (PostgreSQL)
 */
export async function execSql(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
  const client = await getTestClient();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

/**
 * Get a direct MySQL database connection for test verification
 */
export async function getMySqlTestConnection(): Promise<mysql.Connection> {
  return await mysql.createConnection(getMySqlUrl());
}

/**
 * Execute SQL directly for test setup/verification (MySQL)
 */
export async function execMySql(sql: string, params?: unknown[]): Promise<mysql.QueryResult> {
  const connection = await getMySqlTestConnection();
  try {
    const [result] = await connection.execute(sql, params as (string | number | boolean | null)[]);
    return result;
  } finally {
    await connection.end();
  }
}

/**
 * Execute multiple SQL statements in a single connection (MySQL)
 * Useful when session state needs to persist (e.g., FOREIGN_KEY_CHECKS)
 */
export async function execMySqlBatch(statements: string[]): Promise<void> {
  const connection = await getMySqlTestConnection();
  try {
    for (const sql of statements) {
      await connection.execute(sql);
    }
  } finally {
    await connection.end();
  }
}


// ============================================================================
// SQLite Setup Utilities (No Docker needed)
// ============================================================================

/**
 * Create the SQLite test database directory and file
 */
export function createSqliteTestDb(): void {
  const dbDir = path.dirname(TEST_SQLITE_DB_PATH);

  // Create test-data directory if it doesn't exist
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`Created directory: ${dbDir}`);
  }

  // Create empty database file (better-sqlite3 will create tables)
  const db = new Database(TEST_SQLITE_DB_PATH);

  // Enable foreign key support
  db.pragma('foreign_keys = ON');

  db.close();
  console.log(`Created SQLite database: ${TEST_SQLITE_DB_PATH}`);
}

/**
 * Delete the SQLite test database file
 */
export function deleteSqliteTestDb(): void {
  if (fs.existsSync(TEST_SQLITE_DB_PATH)) {
    fs.unlinkSync(TEST_SQLITE_DB_PATH);
    console.log(`Deleted SQLite database: ${TEST_SQLITE_DB_PATH}`);
  }

  // Also clean up the -wal and -shm files if they exist
  const walPath = TEST_SQLITE_DB_PATH + '-wal';
  const shmPath = TEST_SQLITE_DB_PATH + '-shm';

  if (fs.existsSync(walPath)) {
    fs.unlinkSync(walPath);
  }
  if (fs.existsSync(shmPath)) {
    fs.unlinkSync(shmPath);
  }
}

/**
 * Get a SQLite database connection for test setup/verification
 */
export function getSqliteTestDb(): Database.Database {
  const db = new Database(TEST_SQLITE_DB_PATH);
  // Enable foreign key support for each connection
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Execute SQL directly for test setup/verification (SQLite)
 */
export async function execSqliteSql(sql: string): Promise<void> {
  const db = getSqliteTestDb();
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

/**
 * Execute a query and return results (SQLite)
 */
export async function querySqliteSql(sql: string): Promise<unknown[]> {
  const db = getSqliteTestDb();
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

/**
 * Export SQLite path for use in helpers
 */
export { TEST_SQLITE_DB_PATH };
