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
  <a href="#quick-start">Quick Start</a> |
  <a href="#supported-databases">Databases</a> |
  <a href="#mcp-client-configuration">Clients</a> |
  <a href="#available-tools">Tools</a> |
  <a href="#security">Security</a> |
  <a href="#configuration">Configuration</a>
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

## Quick Start

### 1. Create a configuration file

Create `databases.json` in your project directory:

```json
{
  "databases": {
    "mydb": {
      "url": "postgresql://user:password@localhost:5432/myapp"
    }
  }
}
```

### 2. Add to your MCP client

Add to your client's MCP configuration (see [client-specific examples](#mcp-client-configuration) below):

```json
{
  "mcpServers": {
    "datalink": {
      "command": "npx",
      "args": ["-y", "@pilat/mcp-datalink", "--config", "./databases.json"]
    }
  }
}
```

### 3. Start using it!

Your AI assistant now has access to 6 powerful database tools:

- `list_databases` - View all configured connections
- `list_tables` - Browse tables with row estimates
- `describe_table` - Inspect schemas, indexes, and foreign keys
- `query` - Execute SELECT queries safely
- `execute` - Run INSERT/UPDATE/DELETE with write protection
- `explain` - Analyze query execution plans

## MCP Client Configuration

MCP Datalink works with any MCP-compatible client. Here are setup instructions for popular tools:

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "datalink": {
      "command": "npx",
      "args": ["-y", "@pilat/mcp-datalink", "--config", "/path/to/databases.json"]
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Code (CLI)</strong></summary>

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "datalink": {
      "command": "npx",
      "args": ["-y", "@pilat/mcp-datalink", "--config", "./databases.json"]
    }
  }
}
```

Or use the CLI command:

```bash
claude mcp add datalink -- npx -y @pilat/mcp-datalink --config ./databases.json
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to your Cursor MCP settings (Settings > MCP):

```json
{
  "mcpServers": {
    "datalink": {
      "command": "npx",
      "args": ["-y", "@pilat/mcp-datalink", "--config", "./databases.json"]
    }
  }
}
```

</details>

<details>
<summary><strong>Cline (VS Code Extension)</strong></summary>

Add to your Cline MCP configuration in VS Code settings:

```json
{
  "cline.mcpServers": {
    "datalink": {
      "command": "npx",
      "args": ["-y", "@pilat/mcp-datalink", "--config", "./databases.json"]
    }
  }
}
```

</details>

<details>
<summary><strong>Custom MCP Clients</strong></summary>

For any MCP-compatible client, use the standard server configuration:

```json
{
  "command": "npx",
  "args": ["-y", "@pilat/mcp-datalink", "--config", "/absolute/path/to/databases.json"]
}
```

Or with global installation:

```bash
npm install -g @pilat/mcp-datalink
```

```json
{
  "command": "mcp-datalink",
  "args": ["--config", "/absolute/path/to/databases.json"]
}
```

</details>

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

## Configuration

### Configuration File

Create a `databases.json` file with your database connections:

```json
{
  "databases": {
    "production": {
      "url": "postgresql://user:pass@prod.example.com:5432/app",
      "readonly": true
    },
    "development": {
      "url": "postgresql://dev:dev@localhost:5432/app_dev",
      "readonly": false
    },
    "analytics": {
      "url": "mysql://analyst:pass@analytics.example.com:3306/warehouse",
      "readonly": true
    },
    "local": {
      "url": "sqlite:///path/to/database.db"
    }
  },
  "defaults": {
    "timeout": 30000,
    "maxRows": 100,
    "maxCellLength": 500,
    "maxTotalSize": 65536
  }
}
```

### Connection Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | required | Database connection string |
| `readonly` | boolean | `false` | Block INSERT/UPDATE/DELETE operations |
| `maxRows` | number | `100` | Maximum rows returned per query |

### URL Formats

```bash
# PostgreSQL
postgresql://user:password@host:5432/database

# MySQL
mysql://user:password@host:3306/database

# SQLite
sqlite:///absolute/path/to/database.db
sqlite://./relative/path/to/database.db
```

### Environment Variables

Alternative to config file - set connections via environment variables:

```bash
DB_MCP_PRODUCTION_URL=postgresql://user:pass@prod.example.com:5432/app
DB_MCP_DEVELOPMENT_URL=postgresql://dev:dev@localhost:5432/app_dev
```

Pattern: `DB_MCP_{NAME}_URL` creates a connection named `{name}` (lowercase).

### Config Resolution Order

1. CLI argument: `--config ./path/to/config.json`
2. Environment variable: `DB_MCP_CONFIG=/path/to/config.json`
3. Current directory: `./databases.json`
4. Home directory: `~/.config/db-mcp/databases.json`

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

## Installation Options

### Zero-Install (Recommended)

Run directly with `npx` - the package is downloaded automatically:

```bash
npx @pilat/mcp-datalink --config ./databases.json
```

### Global Installation

```bash
npm install -g @pilat/mcp-datalink
mcp-datalink --config ./databases.json
```

### Local Installation

```bash
npm install @pilat/mcp-datalink
npx mcp-datalink --config ./databases.json
```

## Development

```bash
# Clone the repository
git clone https://github.com/pilat/mcp-datalink.git
cd mcp-datalink

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm run test:unit        # Unit tests (fast, no external deps)
npm run test:integration # Integration tests (uses testcontainers)
npm test                 # All tests

# Development mode
npm run dev              # Watch mode with auto-rebuild
```

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js -- --config ./databases.json
```

## Contributing

Contributions are welcome! Please read our contributing guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(tools): add new database tool
fix(security): enforce query validation
docs: update README
```

## Links

- [GitHub Repository](https://github.com/pilat/mcp-datalink)
- [npm Package](https://www.npmjs.com/package/@pilat/mcp-datalink)
- [Issue Tracker](https://github.com/pilat/mcp-datalink/issues)
- [MCP Documentation](https://modelcontextprotocol.io)

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built with care by <a href="https://github.com/pilat">@pilat</a></sub>
</p>
