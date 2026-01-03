# @pilat/mcp-datalink

MCP server for PostgreSQL, MySQL, and SQLite. Gives AI assistants secure database access via [Model Context Protocol](https://modelcontextprotocol.io).

```
npx @pilat/mcp-datalink
```

Works with Claude Desktop, Claude Code, Cursor, Cline, and any MCP-compatible client.

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

**Config locations:** Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`), Claude Code (`~/.claude/settings.json`), Cursor (Settings > MCP), Cline (`cline.mcpServers` in VS Code settings).

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
