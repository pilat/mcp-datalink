<h1 align="center">MCP Datalink</h1>

<p align="center">
  <strong>Secure database access for AI assistants via Model Context Protocol</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@pilat/mcp-datalink"><img src="https://img.shields.io/npm/v/@pilat/mcp-datalink.svg?style=flat-square&color=blue" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@pilat/mcp-datalink"><img src="https://img.shields.io/npm/dm/@pilat/mcp-datalink.svg?style=flat-square&color=green" alt="npm downloads" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License: MIT" /></a>
  <a href="https://github.com/pilat/mcp-datalink"><img src="https://img.shields.io/github/stars/pilat/mcp-datalink?style=flat-square&color=orange" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 20+" />
</p>

<p align="center">
  <a href="#installation">Installation</a> |
  <a href="#supported-databases">Databases</a> |
  <a href="#available-tools">Tools</a> |
  <a href="#security">Security</a>
</p>

---

MCP Datalink is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives AI assistants secure, read/write access to your databases. Connect your favorite AI tools to PostgreSQL, MySQL, or SQLite with enterprise-grade security controls.

```
AI Assistant  <-->  MCP Datalink  <-->  Your Databases
```

## Why MCP Datalink?

- **Universal Compatibility** - Works with any MCP-compatible client: Claude Desktop, Claude Code, Cursor, Cline, and more
- **Multi-Database Support** - Connect PostgreSQL, MySQL, and SQLite simultaneously
- **Security-First Design** - Prepared statements, query validation, readonly modes, and DDL blocking
- **Context-Aware Output** - Smart truncation prevents context overflow in AI conversations
- **Zero-Install Option** - Run directly with `npx` - no global installation required
- **Production Ready** - Battle-tested with comprehensive test coverage

## Supported Databases

| Database | Status | Driver |
|----------|--------|--------|
| <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL" /> | Stable | node-postgres |
| <img src="https://img.shields.io/badge/MySQL-4479A1?style=flat-square&logo=mysql&logoColor=white" alt="MySQL" /> | Stable | mysql2 |
| <img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite" /> | Stable | better-sqlite3 |

## Installation

Add to your MCP client config:

```json
{
  "mcpServers": {
    "datalink": {
      "command": "npx",
      "args": ["-y", "@pilat/mcp-datalink"],
      "env": {
        "DATALINK_MYDB_URL": "postgresql://user:password@localhost:5432/myapp"
      }
    }
  }
}
```

| Variable | Description |
|----------|-------------|
| `DATALINK_{NAME}_URL` | Connection URL (creates database named `{name}`) |
| `DATALINK_{NAME}_READONLY` | Set to `true` to block writes |

**Config file locations:**

| Client | Path |
|--------|------|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `~/.claude/settings.json` |
| Cursor | Settings > MCP |
| Cline | VS Code settings (`cline.mcpServers`) |

## Available Tools

| Tool | Description | Example Use Case |
|------|-------------|------------------|
| `list_databases` | List all configured database connections | "What databases do I have access to?" |
| `list_tables` | List tables with row estimates and types | "Show me all tables in the main database" |
| `describe_table` | Get detailed schema information | "What columns does the users table have?" |
| `query` | Execute SELECT queries (returns Markdown) | "Find all users created this month" |
| `execute` | Execute INSERT/UPDATE/DELETE | "Update the user's email address" |
| `explain` | Show query execution plans | "Why is this query slow?" |

### Example Interaction

```
You: "What tables are in my database?"
AI: Let me check...
    [Uses list_tables tool]

    Found 5 tables:
    - users (15,234 rows)
    - orders (48,291 rows)
    - products (1,205 rows)
    - categories (24 rows)
    - order_items (142,891 rows)
```

## Security

MCP Datalink is designed with security as a core principle:

| Feature | Description |
|---------|-------------|
| **Prepared Statements** | All queries use parameterized queries to prevent SQL injection |
| **Query Validation** | SQL parser validates and restricts query types |
| **Single Statement Only** | Multi-statement queries are rejected |
| **DDL Blocking** | CREATE, DROP, ALTER, TRUNCATE are forbidden |
| **Readonly Mode** | Per-connection write protection |
| **Connection Isolation** | Fresh connection per request, no connection reuse |
| **Output Limits** | Prevents context overflow with configurable size limits |

### Output Limits

To prevent overwhelming AI context windows, all outputs are automatically limited:

| Parameter | Default | Maximum |
|-----------|---------|---------|
| `maxRows` | 100 | 500 |
| `maxCellLength` | 500 chars | 1,000 chars |
| `maxTotalSize` | 64 KB | 256 KB |
| `maxColumns` | 50 | 100 |

When limits are exceeded, responses include `truncated: true` with pagination hints.

## License

MIT
