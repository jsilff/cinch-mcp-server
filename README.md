# Cinch MCP Server

Public MCP bridge for [Cinch](https://app.cinch.work) project management. Runs locally on your machine and talks to the hosted Cinch API using a Personal Access Token (PAT).

## Install

```bash
git clone https://github.com/jsilff/cinch-mcp-server.git
cd cinch-mcp-server
npm install
npm run build
```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `CINCH_API_URL` | Yes | Hosted Cinch URL (e.g. `https://app.cinch.work`) |
| `CINCH_PAT` | Yes | Personal Access Token from Cinch → Settings → Personal Access Tokens |
| `CINCH_COMPANY_ID` | No | Scope operations to one organization |

Create a PAT with scopes for the tools you need (see table below). In the Cinch app, use **Settings → MCP Setup** for a guided config and copy-paste JSON.

## Claude Desktop

```json
{
  "mcpServers": {
    "cinch": {
      "command": "node",
      "args": ["/absolute/path/to/cinch-mcp-server/dist/index.js"],
      "env": {
        "CINCH_API_URL": "https://app.cinch.work",
        "CINCH_PAT": "cinch_xxxxxxxxxxxx"
      }
    }
  }
}
```

Config file (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`

## Cursor

Add the same block to **Settings → MCP** or `.cursor/mcp.json` in your project.

## Tools

| Tool | Scopes |
|------|--------|
| `create_project` | `project:write` |
| `list_projects` | `project:read` |
| `get_project` | `project:read` |
| `create_task` | `task:write` |
| `list_tasks` | `task:read` |
| `get_task` | `task:read` |
| `update_task` | `task:write` |
| `create_comment` | `comment:write` |
| `list_comments` | `comment:read` |
| `list_companies` | `company:read` |
| `get_company` | `company:read` |

## Development

```bash
npm run dev
```

MIT — see [LICENSE](./LICENSE).
