# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-03-10

### Changed

- Replaced per-cell truncation (`maxCellLength: 500`) with a total response size cap — AI now sees full data or gets a clear error instead of silently truncated cells
- Added `DATALINK_MAX_TOTAL_SIZE` environment variable to configure the response size limit (default: 64KB)

### Fixed

- Per-database `maxRows` setting now correctly applies to row truncation (previously only affected SQL LIMIT injection)

## [1.3.2] - 2026-03-03

### Security

- Upgraded @modelcontextprotocol/sdk to 1.27.1 (includes cross-client data leak fix from 1.26.0, GHSA-345p-7cg4-v4c7)
- Upgraded mysql2 to 3.18.0 (includes SQL injection bypass fix from 3.17.0)

### Fixed

- Error cause chain preserved when rethrowing non-Error exceptions

## [1.3.1] - 2026-01-16

### Changed

- Upgraded better-sqlite3 to v12

## [1.3.0] - 2026-01-12

### Added

- Configurable `timeout` parameter for `query`, `execute`, and `explain` tools (5s-10min range)
- `DATALINK_{NAME}_MAX_TIMEOUT` environment variable to cap query timeout per database
- Server instructions now include timeout guidance for AI agents

## [1.2.5] - 2025-01-10

### Added

- Environment variable substitution in connection URLs (`${VAR}` and `${VAR:-default}` syntax)

## [1.2.4] - 2025-01-09

### Fixed

- MCP registry metadata formatting

## [1.2.3] - 2025-01-08

### Added

- MCP registry metadata for discoverability
- Multi-database configuration examples in README
- Client-specific config file locations (Claude Desktop, Cursor, Cline)

## [1.2.2] - 2025-01-07

### Changed

- Improved README documentation

## [1.2.1] - 2025-01-06

### Fixed

- ESM/CJS import compatibility for Node.js 22+

## [1.2.0] - 2025-01-05

### Changed

- Migrated SQL parser to node-sql-parser for better query analysis
- Streamlined README documentation

### Fixed

- Improved SQL injection detection

## [1.1.0] - 2025-01-04

### Added

- Environment-only configuration (removed config file support)
- Improved tool descriptions for better AI agent understanding

### Changed

- Configuration now uses `DATALINK_{NAME}_URL` environment variables

## [1.0.3] - 2025-01-03

### Fixed

- Minor bug fixes

## [1.0.2] - 2025-01-02

### Fixed

- Package publishing issues

## [1.0.1] - 2025-01-01

### Added

- Initial release
- PostgreSQL, MySQL, and SQLite support
- Six database tools: `list_databases`, `list_tables`, `describe_table`, `query`, `execute`, `explain`
- Security features: prepared statements, single statement validation, DDL blocking
- Output truncation (100 rows, 64KB max)
