# notioncli

[![npm version](https://img.shields.io/npm/v/@jordancoin/notioncli.svg)](https://www.npmjs.com/package/@jordancoin/notioncli)
[![CI](https://github.com/JordanCoin/notioncli/actions/workflows/ci.yml/badge.svg)](https://github.com/JordanCoin/notioncli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

A CLI for the Notion API. Aliases instead of UUIDs, property names as flags, full CRUD, automatic pagination, rate limit retry. Built for humans and AI agents.

```bash
npm install -g @jordancoin/notioncli
```

---

## Setup

### 1. Create a Notion Integration

Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations) → **New integration** → copy the API key (`ntn_...`)

### 2. Share Your Databases

In Notion, open each database → **•••** menu → **Connections** → add your integration.

### 3. Initialize

```bash
notion init --key ntn_your_api_key_here
```

```
✅ API key saved

Found 3 databases:
  ✅ project-tracker  → Project Tracker
  ✅ reading-list     → Reading List
  ✅ meeting-notes    → Meeting Notes

3 aliases saved. Try: notion query project-tracker
```

Aliases are created automatically from database names. Rename them anytime:

```bash
notion alias rename project-tracker projects
```

---

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `query` | Query a database | `notion query projects --filter Status=Active` |
| `add` | Create a page | `notion add projects --name "Ship it" --status "Todo"` |
| `update` | Update a page | `notion update projects --filter "Name=Ship it" --status "Done"` |
| `delete` | Archive a page | `notion delete projects --filter "Name=Old task"` |
| `get` | View page details | `notion get projects --filter "Name=Ship it"` |
| `props` | Quick property view | `notion props projects --filter "Name=Ship it"` |
| `blocks` | View page content | `notion blocks projects --filter "Name=Ship it" --ids` |
| `block-edit` | Edit a block | `notion block-edit <block-id> "New text"` |
| `block-delete` | Delete a block | `notion block-delete <block-id>` |
| `append` | Add content to a page | `notion append projects "Update: shipped!" --filter "Name=Ship it"` |
| `search` | Search everything | `notion search "meeting"` |
| `dbs` | List all databases | `notion dbs` |
| `relations` | Explore linked pages | `notion relations tasks --filter "Name=Ship it"` |
| `comments` | View page comments | `notion comments tasks --filter "Name=Ship it"` |
| `comment` | Add a comment | `notion comment tasks "Done! 🚀" --filter "Name=Ship it"` |
| `users` | List workspace users | `notion users` |
| `me` | Show bot identity | `notion me` |
| `move` | Move page between DBs | `notion move tasks --filter "Name=Done" --to archive` |
| `templates` | List DB templates | `notion templates projects` |
| `db-create` | Create a database | `notion db-create <parent-id> "Tasks" --prop "Name:title"` |
| `db-update` | Update DB schema | `notion db-update projects --add-prop "Rating:number"` |
| `upload` | Upload file to page | `notion upload tasks --filter "Name=Ship it" ./file.png` |
| `import` | Import file as pages | `notion import projects ./data.csv` |
| `export` | Export page as markdown | `notion export projects --filter "Name=Ship it"` |
| `alias` | Manage aliases | `notion alias list` |
| `workspace` | Manage workspaces | `notion workspace list` |

---

## Examples

### Query with filters and sorting

```
$ notion query projects --filter Status=Active --sort Date:desc --limit 5

Date       │ Name            │ Status │ Priority
───────────┼─────────────────┼────────┼──────────
2026-02-09 │ Launch CLI      │ Active │ High
2026-02-08 │ Write Docs      │ Active │ Medium

2 results
```

### Rich filter operators

```bash
# Comparison operators
notion query tasks --filter "Priority>3"
notion query tasks --filter "Count>=10"
notion query tasks --filter "Status!=Draft"

# Multiple filters (AND)
notion query tasks --filter Status=Active --filter Priority=High

# Relative dates
notion query tasks --filter "Due=today"
notion query tasks --filter "Created>=last_week"

# Values containing operators (parsed correctly)
notion query tasks --filter "Description=score>=90"
notion query tasks --filter 'Notes="contains quotes"'
```

### Dynamic property flags

Property names from your database schema become CLI flags automatically:

```bash
# Instead of --prop "Name=Ship it" --prop "Status=Done":
notion add projects --name "Ship it" --status "Done" --priority "High"
notion update projects --filter "Name=Ship it" --status "Complete"
```

### Import data

```bash
# CSV or JSON → database pages
notion import projects ./tasks.csv
notion import projects ./data.json

# Markdown → page with content blocks
notion add projects --name "My Notes" --from notes.md
```

### Export content

```bash
# Page content → markdown
notion export projects --filter "Name=Ship it"
# Outputs: # Ship it\n\nPage content as markdown...
```

### View page details (relations auto-resolved)

```
$ notion get tasks --filter "Name=Implement relations"

Page: a1b2c3d4-5678-90ab-cdef-1234567890ab
URL:  https://www.notion.so/...

Properties:
  Name: Implement relations
  Project: Build CLI              ← relation resolved to title
  Done: ✓
  Task Count: 3                   ← rollup parsed to number
```

### Multi-workspace

```bash
notion workspace add work --key ntn_work_key
notion workspace add personal --key ntn_personal_key
notion workspace use work
notion init   # discovers databases for active workspace

# Per-command override
notion query tasks --workspace personal
notion -w work add projects --name "Q2 Plan"
```

### Output formats

```bash
notion query tasks --output table   # default
notion query tasks --output csv
notion query tasks --output json
notion query tasks --output yaml
notion --json query tasks           # raw API response (pipe to jq)
```

---

## AI Agent Usage

notioncli works well as a tool for LLMs and coding agents — no API key juggling, no JSON formatting, just shell commands:

```bash
notion dbs                                    # discover databases
notion alias list                             # see available aliases
notion query tasks --filter Status=Todo       # read data
notion add tasks --name "Fix bug" --status "In Progress"   # write data
notion --json query tasks --limit 10          # structured output for parsing
```

Every page-targeted command accepts `alias + --filter` instead of UUIDs:

```bash
# No UUIDs needed — ever
notion update projects --filter "Name=Ship it" --status "Done"
notion delete projects --filter "Name=Old task"
notion blocks projects --filter "Name=Ship it" --ids
```

---

## Configuration

Config lives at `~/.config/notioncli/config.json`. API key resolution: `NOTION_API_KEY` env var → config file.

```bash
notion alias list       # see aliases
notion alias add tasks <database-id>   # manual alias
notion workspace list   # see workspaces
```

---

## Reliability

- **Automatic pagination** — All list endpoints fetch every result by default. Use `--limit` to cap.
- **Rate limit retry** — 429 responses trigger exponential backoff with jitter (up to 5 attempts). Transparent — no flags needed.
- **Input validation** — Numbers, dates, URLs, and emails are validated before hitting the API. Clear error messages instead of cryptic 400s.

## Technical Details

For API internals, the 2025 dual-ID system, modular architecture, and testing (213 tests): see **[TECHNICAL.md](./TECHNICAL.md)**.

---

## License

MIT © [JordanCoin](https://github.com/JordanCoin)
