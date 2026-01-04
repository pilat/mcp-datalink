# @pilat/mcp-datalink

MCP server for PostgreSQL, MySQL, and SQLite. Gives AI assistants secure database access via [Model Context Protocol](https://modelcontextprotocol.io).

```
npx @pilat/mcp-datalink
```

Works with Claude Desktop, Claude Code, Cursor, Cline, and any MCP-compatible client.

## Installation

Add to your MCP client config file (see [config locations](#config-file-locations) below):

```json
{
  "mcpServers": {
    "datalink": {
      "command": "npx",
      "args": ["-y", "@pilat/mcp-datalink"],
      "env": {
        "DATALINK_ANALYTICS_URL": "postgresql://user:password@localhost:5432/analytics",
        "DATALINK_ANALYTICS_READONLY": "true",

        "DATALINK_INVENTORY_URL": "mysql://user:password@localhost:3306/inventory",

        "DATALINK_CACHE_URL": "sqlite:///path/to/cache.db"
      }
    }
  }
}
```

This creates three database connections: `analytics` (read-only), `inventory`, and `cache`.

| Variable | Description |
|----------|-------------|
| `DATALINK_{NAME}_URL` | Connection URL (creates database named `{name}`) |
| `DATALINK_{NAME}_READONLY` | Set to `true` to block writes |

**Connection URL formats:**

```bash
# PostgreSQL
postgresql://user:password@localhost:5432/dbname
postgresql://user:password@localhost:5432/dbname?sslmode=require

# MySQL
mysql://user:password@localhost:3306/dbname
mysql://user:password@localhost:3306/dbname?ssl=true

# SQLite
sqlite:///path/to/database.db
sqlite:///Users/me/data/app.sqlite
sqlite://../relative/path/data.db
```

### Config File Locations

| Client | Config file |
|--------|-------------|
| Claude Code | `~/.claude/settings.local.json` (global) or `.mcp.json` (project) |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` or Settings → Features → MCP Servers |
| Cline | `cline_mcp_settings.json` or VS Code settings `cline.mcpServers` |

## Tools

| Tool | Description |
|------|-------------|
| `list_databases` | List configured database connections |
| `list_tables` | List tables with row counts |
| `describe_table` | Get schema, indexes, foreign keys |
| `query` | Run SELECT queries |
| `execute` | Run INSERT/UPDATE/DELETE |
| `explain` | Show query execution plans |

## Security

- Prepared statements only (no SQL injection)
- Single statement per query (no chaining)
- DDL blocked (no DROP, ALTER, TRUNCATE)
- Readonly mode per connection
- Output truncation (100 rows, 64KB max)

## License

MIT
