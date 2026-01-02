/**
 * Vitest global setup for integration tests
 *
 * Starts PostgreSQL and MySQL containers and initializes the test databases.
 * Also creates and initializes the SQLite test database (no Docker needed).
 */

import { startContainers, createSqliteTestDb } from './setup.js';
import {
  initializeSchema,
  seedTestData,
  initializeMySqlSchema,
  seedMySqlTestData,
  initializeSqliteSchema,
  seedSqliteTestData,
} from './helpers.js';

export default async function globalSetup(): Promise<void> {
  console.log('\n=== Integration Test Setup ===\n');

  // Start both PostgreSQL and MySQL containers
  await startContainers();

  // Initialize PostgreSQL schema
  console.log('Initializing PostgreSQL schema...');
  await initializeSchema();

  // Seed PostgreSQL test data
  console.log('Seeding PostgreSQL test data...');
  await seedTestData();

  // Initialize MySQL schema
  console.log('Initializing MySQL schema...');
  await initializeMySqlSchema();

  // Seed MySQL test data
  console.log('Seeding MySQL test data...');
  await seedMySqlTestData();

  // Create and initialize SQLite database (no Docker needed)
  console.log('Creating SQLite test database...');
  createSqliteTestDb();

  console.log('Initializing SQLite schema...');
  await initializeSqliteSchema();

  console.log('Seeding SQLite test data...');
  await seedSqliteTestData();

  console.log('\n=== Setup Complete ===\n');
}
