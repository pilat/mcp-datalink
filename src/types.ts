/**
 * Core types for db-mcp server
 */

export type QueryType = 'select' | 'insert' | 'update' | 'delete' | 'other';

export interface ParsedQuery {
  type: QueryType;
  hasLimit: boolean;
  isDangerous: boolean;
  dangerousReason?: string;
  sql: string;
}

export interface DatabaseConfig {
  url: string;
  readonly: boolean;
  maxRows?: number;
}

export interface DefaultsConfig {
  maxRows: number;
  maxCellLength: number;
  maxTotalSize: number;
  maxColumns: number;
  maxTables: number;
  maxIndexes: number;
  timeout: number;
}

export interface Config {
  databases: Record<string, DatabaseConfig>;
  defaults: DefaultsConfig;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  truncationReason?: string;
  totalAvailable?: number;
  returned?: number;
  hint?: string;
  executionTime: number;
}

export interface ExecuteResult {
  command: string;
  rowsAffected: number;
  executionTime: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  primaryKey: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface ForeignKeyInfo {
  column: string;
  references: {
    table: string;
    column: string;
  };
}

export interface TableDescription {
  table: string;
  schema: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  truncated: boolean;
  truncationReason?: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  type: 'table' | 'view';
  rows_estimate: number | null;
}

// Tool Parameters

export interface ListDatabasesResult {
  databases: Array<{
    name: string;
    readonly: boolean;
  }>;
}

export interface ListTablesParams {
  database: string;
  schema?: string;
}

export interface ListTablesResult {
  tables: TableInfo[];
  truncated: boolean;
  totalAvailable?: number;
}

export interface DescribeTableParams {
  database: string;
  table: string;
  schema?: string;
}

export interface QueryParams {
  database: string;
  sql: string;
  params?: unknown[];
}

export interface ExecuteParams {
  database: string;
  sql: string;
  params?: unknown[];
}

export interface ExplainParams {
  database: string;
  sql: string;
  analyze?: boolean;
}

export interface ExplainResult {
  plan: string;
  executionTime: number;
}
