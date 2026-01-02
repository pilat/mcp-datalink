/**
 * Integration test helpers
 *
 * Provides test configuration factory and database utilities.
 */

import type { Config } from '../types.js';
import { execSql, execSqliteSql, getSqliteTestDb, execMySql, execMySqlBatch, getPostgresUrl, getMySqlUrl } from './setup.js';

const TEST_SQLITE_DB_PATH = './test-data/test.db';

/**
 * Create a test configuration with optional overrides
 */
export function createTestConfig(overrides?: Partial<Config>): Config {
  const postgresUrl = getPostgresUrl();
  const base: Config = {
    databases: {
      testdb: {
        url: postgresUrl,
        readonly: false,
      },
      readonlydb: {
        url: postgresUrl,
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

  if (!overrides) {
    return base;
  }

  // Handle databases override - if explicitly provided, use it directly
  const databases =
    'databases' in overrides
      ? overrides.databases ?? base.databases
      : base.databases;

  // Handle defaults override - merge with base
  const defaults =
    'defaults' in overrides
      ? { ...base.defaults, ...overrides.defaults }
      : base.defaults;

  return { databases, defaults };
}

/**
 * Initialize the test database schema
 */
export async function initializeSchema(): Promise<void> {
  const schema = `
    -- Drop existing tables in reverse FK order
    DROP TABLE IF EXISTS order_items CASCADE;
    DROP TABLE IF EXISTS orders CASCADE;
    DROP TABLE IF EXISTS products CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    DROP TABLE IF EXISTS wide_table CASCADE;
    DROP VIEW IF EXISTS user_order_summary CASCADE;
    DROP SCHEMA IF EXISTS test_schema CASCADE;

    -- Users table with various column types
    CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(100),
        age INTEGER,
        balance DECIMAL(10, 2) DEFAULT 0.00,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT true
    );

    -- Indexes for testing
    CREATE INDEX users_created_at_idx ON users(created_at);
    CREATE INDEX users_name_email_idx ON users(name, email);

    -- Products table
    CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        stock INTEGER DEFAULT 0,
        category VARCHAR(100)
    );

    -- Orders table with foreign key
    CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        total DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        items JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX orders_user_id_idx ON orders(user_id);
    CREATE INDEX orders_status_idx ON orders(status);

    -- Order items junction table
    CREATE TABLE order_items (
        order_id INTEGER NOT NULL REFERENCES orders(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL DEFAULT 1,
        price_at_time DECIMAL(10, 2) NOT NULL,
        PRIMARY KEY (order_id, product_id)
    );

    -- View for testing view detection
    CREATE VIEW user_order_summary AS
    SELECT
        u.id as user_id,
        u.email,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total), 0) as total_spent
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    GROUP BY u.id, u.email;

    -- Wide table for truncation testing
    CREATE TABLE wide_table (
        id SERIAL PRIMARY KEY,
        col_01 TEXT, col_02 TEXT, col_03 TEXT, col_04 TEXT, col_05 TEXT,
        col_06 TEXT, col_07 TEXT, col_08 TEXT, col_09 TEXT, col_10 TEXT,
        col_11 TEXT, col_12 TEXT, col_13 TEXT, col_14 TEXT, col_15 TEXT,
        col_16 TEXT, col_17 TEXT, col_18 TEXT, col_19 TEXT, col_20 TEXT,
        col_21 TEXT, col_22 TEXT, col_23 TEXT, col_24 TEXT, col_25 TEXT,
        col_26 TEXT, col_27 TEXT, col_28 TEXT, col_29 TEXT, col_30 TEXT,
        col_31 TEXT, col_32 TEXT, col_33 TEXT, col_34 TEXT, col_35 TEXT,
        col_36 TEXT, col_37 TEXT, col_38 TEXT, col_39 TEXT, col_40 TEXT,
        col_41 TEXT, col_42 TEXT, col_43 TEXT, col_44 TEXT, col_45 TEXT,
        col_46 TEXT, col_47 TEXT, col_48 TEXT, col_49 TEXT, col_50 TEXT,
        col_51 TEXT, col_52 TEXT, col_53 TEXT, col_54 TEXT, col_55 TEXT
    );

    -- Test schema for non-public schema testing
    CREATE SCHEMA test_schema;

    CREATE TABLE test_schema.special_table (
        id SERIAL PRIMARY KEY,
        data TEXT
    );
  `;

  await execSql(schema);
}

/**
 * Seed the test database with sample data
 * Uses TRUNCATE CASCADE for fast, atomic cleanup then re-insert
 */
export async function seedTestData(): Promise<void> {
  // Use TRUNCATE CASCADE for fast, atomic cleanup
  await execSql('TRUNCATE users, products, orders, order_items RESTART IDENTITY CASCADE');

  const seed = `
    -- Seed users
    INSERT INTO users (id, email, name, age, balance, metadata, is_active) VALUES
        ('11111111-1111-1111-1111-111111111111', 'alice@example.com', 'Alice Smith', 30, 1000.50, '{"role": "admin"}', true),
        ('22222222-2222-2222-2222-222222222222', 'bob@example.com', 'Bob Jones', 25, 500.00, '{"role": "user"}', true),
        ('33333333-3333-3333-3333-333333333333', 'charlie@example.com', 'Charlie Brown', 35, 0.00, null, false);

    -- Seed products
    INSERT INTO products (id, name, price, stock, category) VALUES
        (1, 'Widget', 9.99, 100, 'gadgets'),
        (2, 'Gadget', 19.99, 50, 'gadgets'),
        (3, 'Thingamajig', 29.99, 25, 'misc');

    -- Reset sequence after explicit ID inserts
    SELECT setval('products_id_seq', 3);

    -- Seed orders
    INSERT INTO orders (id, user_id, total, status, items) VALUES
        (1, '11111111-1111-1111-1111-111111111111', 29.98, 'completed', '[{"product_id": 1, "qty": 2}]'),
        (2, '11111111-1111-1111-1111-111111111111', 19.99, 'pending', '[{"product_id": 2, "qty": 1}]'),
        (3, '22222222-2222-2222-2222-222222222222', 9.99, 'completed', '[{"product_id": 1, "qty": 1}]');

    SELECT setval('orders_id_seq', 3);

    -- Seed order items
    INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES
        (1, 1, 2, 9.99),
        (2, 2, 1, 19.99),
        (3, 1, 1, 9.99);

    -- Seed test_schema
    DELETE FROM test_schema.special_table;
    INSERT INTO test_schema.special_table (id, data) VALUES (1, 'test data');

    -- Force stats update for row estimates
    ANALYZE;
  `;

  await execSql(seed);
}

/**
 * Clean up test data between tests
 */
export async function cleanupTestData(): Promise<void> {
  await execSql(`
    TRUNCATE order_items, orders, products, users RESTART IDENTITY CASCADE;
    TRUNCATE test_schema.special_table RESTART IDENTITY CASCADE;
  `);
}

// ============================================================================
// SQLite Test Configuration and Helpers
// ============================================================================

/**
 * Create a SQLite test configuration with optional overrides
 */
export function createSqliteTestConfig(overrides?: Partial<Config>): Config {
  const base: Config = {
    databases: {
      sqlitedb: {
        url: `sqlite://${TEST_SQLITE_DB_PATH}`,
        readonly: false,
      },
      sqlitedb_readonly: {
        url: `sqlite://${TEST_SQLITE_DB_PATH}`,
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

  if (!overrides) {
    return base;
  }

  // Handle databases override - if explicitly provided, use it directly
  const databases =
    'databases' in overrides
      ? overrides.databases ?? base.databases
      : base.databases;

  // Handle defaults override - merge with base
  const defaults =
    'defaults' in overrides
      ? { ...base.defaults, ...overrides.defaults }
      : base.defaults;

  return { databases, defaults };
}

/**
 * Initialize the SQLite test database schema
 */
export async function initializeSqliteSchema(): Promise<void> {
  // Drop existing tables in reverse FK order
  await execSqliteSql('DROP TABLE IF EXISTS order_items');
  await execSqliteSql('DROP TABLE IF EXISTS orders');
  await execSqliteSql('DROP TABLE IF EXISTS products');
  await execSqliteSql('DROP TABLE IF EXISTS users');
  await execSqliteSql('DROP TABLE IF EXISTS wide_table');
  await execSqliteSql('DROP VIEW IF EXISTS user_order_summary');

  // Users table with SQLite-compatible types
  await execSqliteSql(`
    CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        age INTEGER,
        balance REAL DEFAULT 0.00,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT,
        is_active INTEGER DEFAULT 1
    )
  `);

  // Create indexes for testing
  await execSqliteSql('CREATE INDEX users_created_at_idx ON users(created_at)');
  await execSqliteSql('CREATE INDEX users_name_email_idx ON users(name, email)');

  // Products table
  await execSqliteSql(`
    CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        stock INTEGER DEFAULT 0,
        category TEXT
    )
  `);

  // Orders table with foreign key
  await execSqliteSql(`
    CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        total REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        items TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await execSqliteSql('CREATE INDEX orders_user_id_idx ON orders(user_id)');
  await execSqliteSql('CREATE INDEX orders_status_idx ON orders(status)');

  // Order items junction table
  await execSqliteSql(`
    CREATE TABLE order_items (
        order_id INTEGER NOT NULL REFERENCES orders(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL DEFAULT 1,
        price_at_time REAL NOT NULL,
        PRIMARY KEY (order_id, product_id)
    )
  `);

  // View for testing view detection
  await execSqliteSql(`
    CREATE VIEW user_order_summary AS
    SELECT
        u.id as user_id,
        u.email,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total), 0) as total_spent
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    GROUP BY u.id, u.email
  `);

  // Wide table for truncation testing
  const wideCols = Array.from({ length: 55 }, (_, i) =>
    `col_${String(i + 1).padStart(2, '0')} TEXT`
  ).join(', ');
  await execSqliteSql(`
    CREATE TABLE wide_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ${wideCols}
    )
  `);
}

/**
 * Seed the SQLite test database with sample data
 * Uses full cleanup + re-insert to ensure consistent state
 */
export async function seedSqliteTestData(): Promise<void> {
  // Run cleanup in a single connection with FKs disabled
  // getSqliteTestDb() auto-enables FKs, so we disable them first
  const db = getSqliteTestDb();
  try {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM order_items;
      DELETE FROM orders;
      DELETE FROM products;
      DELETE FROM users;
      PRAGMA foreign_keys = ON;
    `);
  } finally {
    db.close();
  }

  // Seed users
  await execSqliteSql(`
    INSERT INTO users (id, email, name, age, balance, metadata, is_active) VALUES
        ('11111111-1111-1111-1111-111111111111', 'alice@example.com', 'Alice Smith', 30, 1000.50, '{"role": "admin"}', 1),
        ('22222222-2222-2222-2222-222222222222', 'bob@example.com', 'Bob Jones', 25, 500.00, '{"role": "user"}', 1),
        ('33333333-3333-3333-3333-333333333333', 'charlie@example.com', 'Charlie Brown', 35, 0.00, null, 0)
  `);

  // Seed products
  await execSqliteSql(`
    INSERT INTO products (id, name, price, stock, category) VALUES
        (1, 'Widget', 9.99, 100, 'gadgets'),
        (2, 'Gadget', 19.99, 50, 'gadgets'),
        (3, 'Thingamajig', 29.99, 25, 'misc')
  `);

  // Seed orders
  await execSqliteSql(`
    INSERT INTO orders (id, user_id, total, status, items) VALUES
        (1, '11111111-1111-1111-1111-111111111111', 29.98, 'completed', '[{"product_id": 1, "qty": 2}]'),
        (2, '11111111-1111-1111-1111-111111111111', 19.99, 'pending', '[{"product_id": 2, "qty": 1}]'),
        (3, '22222222-2222-2222-2222-222222222222', 9.99, 'completed', '[{"product_id": 1, "qty": 1}]')
  `);

  // Seed order items
  await execSqliteSql(`
    INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES
        (1, 1, 2, 9.99),
        (2, 2, 1, 19.99),
        (3, 1, 1, 9.99)
  `);
}

/**
 * Clean up SQLite test data between tests
 */
export async function cleanupSqliteTestData(): Promise<void> {
  await execSqliteSql('DELETE FROM order_items');
  await execSqliteSql('DELETE FROM orders');
  await execSqliteSql('DELETE FROM products');
  await execSqliteSql('DELETE FROM users');
}

// ============================================================================
// MySQL Test Configuration and Helpers
// ============================================================================

/**
 * Create a MySQL test configuration with optional overrides
 */
export function createMySqlTestConfig(overrides?: Partial<Config>): Config {
  const mysqlUrl = getMySqlUrl();
  const base: Config = {
    databases: {
      mysqldb: {
        url: mysqlUrl,
        readonly: false,
      },
      mysqldb_readonly: {
        url: mysqlUrl,
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

  if (!overrides) {
    return base;
  }

  // Handle databases override - if explicitly provided, use it directly
  const databases =
    'databases' in overrides
      ? overrides.databases ?? base.databases
      : base.databases;

  // Handle defaults override - merge with base
  const defaults =
    'defaults' in overrides
      ? { ...base.defaults, ...overrides.defaults }
      : base.defaults;

  return { databases, defaults };
}

/**
 * Initialize the MySQL test database schema
 */
export async function initializeMySqlSchema(): Promise<void> {
  // Drop existing tables in reverse FK order
  // MySQL requires disabling foreign key checks to drop tables with FK dependencies
  await execMySql('SET FOREIGN_KEY_CHECKS = 0');

  await execMySql('DROP TABLE IF EXISTS order_items');
  await execMySql('DROP TABLE IF EXISTS orders');
  await execMySql('DROP TABLE IF EXISTS products');
  await execMySql('DROP TABLE IF EXISTS users');
  await execMySql('DROP TABLE IF EXISTS wide_table');
  await execMySql('DROP VIEW IF EXISTS user_order_summary');

  await execMySql('SET FOREIGN_KEY_CHECKS = 1');

  // Users table with MySQL-compatible types
  await execMySql(`
    CREATE TABLE users (
        id CHAR(36) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(100),
        age INT,
        balance DECIMAL(10, 2) DEFAULT 0.00,
        metadata JSON,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL,
        is_active BOOLEAN DEFAULT TRUE
    )
  `);

  // Create indexes for testing
  await execMySql('CREATE INDEX users_created_at_idx ON users(created_at)');
  await execMySql('CREATE INDEX users_name_email_idx ON users(name, email)');

  // Products table
  await execMySql(`
    CREATE TABLE products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        stock INT DEFAULT 0,
        category VARCHAR(100)
    )
  `);

  // Orders table with foreign key
  await execMySql(`
    CREATE TABLE orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id CHAR(36) NOT NULL,
        total DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        items JSON NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await execMySql('CREATE INDEX orders_user_id_idx ON orders(user_id)');
  await execMySql('CREATE INDEX orders_status_idx ON orders(status)');

  // Order items junction table
  await execMySql(`
    CREATE TABLE order_items (
        order_id INT NOT NULL,
        product_id INT NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        price_at_time DECIMAL(10, 2) NOT NULL,
        PRIMARY KEY (order_id, product_id),
        CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
        CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  // View for testing view detection
  await execMySql(`
    CREATE VIEW user_order_summary AS
    SELECT
        u.id as user_id,
        u.email,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total), 0) as total_spent
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    GROUP BY u.id, u.email
  `);

  // Wide table for truncation testing
  const wideCols = Array.from({ length: 55 }, (_, i) =>
    `col_${String(i + 1).padStart(2, '0')} TEXT`
  ).join(', ');
  await execMySql(`
    CREATE TABLE wide_table (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ${wideCols}
    )
  `);
}

/**
 * Seed the MySQL test database with sample data
 * Uses TRUNCATE for fast cleanup then re-insert
 */
export async function seedMySqlTestData(): Promise<void> {
  // Use execMySqlBatch for atomic cleanup with FK checks disabled
  await execMySqlBatch([
    'SET FOREIGN_KEY_CHECKS = 0',
    'TRUNCATE TABLE order_items',
    'TRUNCATE TABLE orders',
    'TRUNCATE TABLE products',
    'TRUNCATE TABLE users',
    'SET FOREIGN_KEY_CHECKS = 1',
  ]);

  // Seed data in correct order (respecting FK constraints)
  await execMySql(`
    INSERT INTO users (id, email, name, age, balance, metadata, is_active) VALUES
        ('11111111-1111-1111-1111-111111111111', 'alice@example.com', 'Alice Smith', 30, 1000.50, '{"role": "admin"}', TRUE),
        ('22222222-2222-2222-2222-222222222222', 'bob@example.com', 'Bob Jones', 25, 500.00, '{"role": "user"}', TRUE),
        ('33333333-3333-3333-3333-333333333333', 'charlie@example.com', 'Charlie Brown', 35, 0.00, NULL, FALSE)
  `);

  await execMySql(`
    INSERT INTO products (id, name, price, stock, category) VALUES
        (1, 'Widget', 9.99, 100, 'gadgets'),
        (2, 'Gadget', 19.99, 50, 'gadgets'),
        (3, 'Thingamajig', 29.99, 25, 'misc')
  `);

  await execMySql(`
    INSERT INTO orders (id, user_id, total, status, items) VALUES
        (1, '11111111-1111-1111-1111-111111111111', 29.98, 'completed', '[{"product_id": 1, "qty": 2}]'),
        (2, '11111111-1111-1111-1111-111111111111', 19.99, 'pending', '[{"product_id": 2, "qty": 1}]'),
        (3, '22222222-2222-2222-2222-222222222222', 9.99, 'completed', '[{"product_id": 1, "qty": 1}]')
  `);

  await execMySql(`
    INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES
        (1, 1, 2, 9.99),
        (2, 2, 1, 19.99),
        (3, 1, 1, 9.99)
  `);

  // Update table statistics for row estimates
  await execMySql('ANALYZE TABLE users, products, orders, order_items');
}

/**
 * Clean up MySQL test data between tests
 */
export async function cleanupMySqlTestData(): Promise<void> {
  await execMySqlBatch([
    'SET FOREIGN_KEY_CHECKS = 0',
    'TRUNCATE TABLE order_items',
    'TRUNCATE TABLE orders',
    'TRUNCATE TABLE products',
    'TRUNCATE TABLE users',
    'SET FOREIGN_KEY_CHECKS = 1',
  ]);
}
