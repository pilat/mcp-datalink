/**
 * Vitest global teardown for integration tests
 *
 * Stops and removes the PostgreSQL and MySQL containers.
 * Deletes the SQLite test database file.
 */

import { stopContainers, deleteSqliteTestDb } from './setup.js';

export default async function globalTeardown(): Promise<void> {
  console.log('\n=== Integration Test Teardown ===\n');

  // Stop all test containers (PostgreSQL + MySQL)
  await stopContainers();

  // Delete SQLite test database file
  console.log('Deleting SQLite test database...');
  deleteSqliteTestDb();

  console.log('\n=== Teardown Complete ===\n');
}
