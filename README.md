# notioncli

[![npm version](https://img.shields.io/npm/v/@jordancoin/notioncli.svg)](https://www.npmjs.com/package/@jordancoin/notioncli)
[![CI](https://github.com/JordanCoin/notioncli/actions/workflows/ci.yml/badge.svg)](https://github.com/JordanCoin/notioncli/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/JordanCoin/notioncli/branch/main/graph/badge.svg)](https://codecov.io/gh/JordanCoin/notioncli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

A powerful CLI for the Notion API — aliases, zero UUIDs, relations & rollups, and full block-level CRUD. Built for humans and AI agents.

**No more copy-pasting UUIDs.** Set up aliases once, then just type `notion query tasks` or `notion add projects --prop "Name=Ship it"`.

```bash
npm install -g @jordancoin/notioncli
```

## Quick Start

```bash
# 1. One command to set up
notion init --key ntn_your_api_key_here

# That's it. Aliases are created automatically:
#   ✅ projects     → Project Tracker
#   ✅ reading-list → Reading List
#   ✅ meetings     → Meeting Notes

# 2. Start using them immediately
notion query projects
notion add projects --prop "Name=Ship it" --prop "Status=Todo"
```

Zero UUIDs. One command. You're ready to go.

---

## What's New

### v1.2 — Multi-Workspace, Database Management & File Uploads

- 🏢 **Multi-workspace** — Named profiles for multiple Notion accounts (`workspace add/use/list/remove`, `--workspace` flag)
- 🤖 **`me`** — Show integration/bot identity and owner
- 📦 **`move`** — Move pages between databases by alias
- 📋 **`templates`** — List page templates available for a database
- 🏗️ **`db-create`** — Create new databases with custom property schemas
- ✏️ **`db-update`** — Add/remove columns, rename databases
- 📎 **`upload`** — Upload files to pages (MIME-aware, supports images/docs/text)
- 🔍 **`props`** — Quick page property inspector (cleaner than `get` for debugging)
- 🐛 **Fixed** canonical `database_id` resolution for the 2025 dual-ID system

### v1.1 — Relations, Rollups & Blocks

- 🔗 **Relations** — `get` resolves linked page titles automatically. New `notion relations` command for exploring connected pages.
- 📊 **Rollups** — Numbers, dates, and arrays are parsed into readable values. No more raw JSON blobs.
- 🧱 **Blocks CRUD** — Edit and delete blocks directly with `block-edit` and `block-delete`. Use `--ids` flag on `blocks` for precise targeting.

---

## Notion as a Graph

Notion databases don't live in isolation — they're connected by relations and rollups. notioncli treats your workspace as a **graph of linked pages**:

```
$ notion get tasks --filter "Name=Ship v1.1"
Properties:
  Name: Ship v1.1
  Status: Active
  Project: Launch CLI        ← relation resolved to title
  Task Count: 3              ← rollup parsed to number

$ notion relations tasks --filter "Name=Ship v1.1"
Project: 1 linked page
id        │ title      │ url
──────────┼────────────┼──────────────────────
302903e2… │ Launch CLI │ https://notion.so/...
```

Relations resolve to human-readable titles. Rollups return real values. Blocks can be queried, edited, and deleted directly. This makes it possible to explore, automate, and reason about complex workspaces entirely from the CLI.

---

## Setup

### 1. Create a Notion Integration

1. Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations)
2. Click **"New integration"**
3. Give it a name (e.g. "My CLI")
4. Copy the API key (starts with `ntn_`)

### 2. Share Your Databases

In Notion, open each database you want to access:
- Click the **•••** menu → **Connections** → Add your integration

### 3. Initialize

```bash
notion init --key ntn_your_api_key_here
```

This saves your key, discovers all shared databases, and **creates aliases automatically**:

```
✅ API key saved to ~/.config/notioncli/config.json

Found 3 databases:

  ✅ project-tracker        → Project Tracker
  ✅ reading-list           → Reading List
  ✅ meeting-notes          → Meeting Notes

3 aliases saved automatically.

Ready! Try:
  notion query project-tracker
  notion add project-tracker --prop "Name=Hello World"
```

That's it — no IDs, no extra steps. If you want shorter names:

```bash
notion alias rename project-tracker projects
notion alias rename reading-list reads
```

> **Alternative:** Skip `init` and set an environment variable:
> ```bash
> export NOTION_API_KEY=ntn_your_api_key
> ```

---

## Commands

### `notion query` — Query a Database

The command you'll use most. Filter, sort, and browse your data. Rollups are automatically parsed into numbers, dates, or arrays instead of raw JSON.

```
$ notion query projects
Date       │ Name            │ Status │ Priority
───────────┼─────────────────┼────────┼──────────
2026-02-09 │ Launch CLI      │ Active │ High
2026-02-08 │ Write Docs      │ Active │ Medium
2026-02-07 │ Design Landing  │ Done   │ Low

3 results
```

With filters and sorting:

```
$ notion query projects --filter Status=Active --sort Date:desc --limit 5
```

### `notion add` — Add a Page

```
$ notion add projects --prop "Name=New Feature" --prop "Status=Todo" --prop "Date=2026-02-10"
✅ Created page: a1b2c3d4-...
   URL: https://www.notion.so/...
```

Properties are matched **case-insensitively** against the database schema. No need to memorize exact field names.

**Supported types:** title, rich_text, number, select, multi_select, date, checkbox, url, email, phone_number, status.

### `notion update` — Update a Page

By page ID:
```
$ notion update a1b2c3d4-5678-90ab-cdef-1234567890ab --prop "Status=Done" --prop "Priority=Low"
✅ Updated page: a1b2c3d4-...
```

By alias + filter (no UUIDs needed):
```
$ notion update workouts --filter "Name=LEGS #5" --prop "Notes=Great session"
✅ Updated page: a1b2c3d4-...
```

### `notion delete` — Delete (Archive) a Page

```
$ notion delete workouts --filter "Date=2026-02-09"
🗑️  Archived page: a1b2c3d4-...
   (Restore it from the trash in Notion if needed)
```

### `notion get` — View Page Details

Relations are **automatically resolved** to linked page titles:

```
$ notion get tasks --filter "Name=Implement relations"
Page: a1b2c3d4-5678-90ab-cdef-1234567890ab
URL:  https://www.notion.so/...
Created: 2026-02-10T14:30:00.000Z
Updated: 2026-02-10T14:30:00.000Z

Properties:
  Name: Implement relations
  Project: Build CLI              ← resolved title, not a UUID
  Done: ✓
```

### `notion relations` — Explore Connections

See what a page is linked to, with resolved titles and URLs:

```
$ notion relations tasks --filter "Name=Implement relations"
Project: 1 linked page
id        │ title     │ url
──────────┼───────────┼──────────────────────
302903e2… │ Build CLI │ https://notion.so/...
```

### `notion blocks` — View & Edit Page Content

View blocks with optional IDs for targeting:

```
$ notion blocks tasks --filter "Name=Ship v1.1" --ids
[a1b2c3d4] # Project Overview
[e5f67890] This is the main project page.
[abcd1234] • First task
[efgh5678] ☑ Completed item
```

In v1.1+, blocks are fully editable and deletable — not just readable:

```
$ notion block-edit a1b2c3d4-5678-90ab-cdef-1234567890ab "Updated heading text"
✅ Updated heading_1 block: a1b2c3d4…

$ notion block-delete a1b2c3d4-5678-90ab-cdef-1234567890ab
🗑️  Deleted block: a1b2c3d4…
```

Use `notion blocks --ids` to list block IDs for precise edits.

### `notion append` — Add Content to a Page

```
$ notion append tasks "Status update: phase 1 complete" --filter "Name=Ship feature"
✅ Appended text block to page a1b2c3d4-...
```

### `notion dbs` — List All Databases

```
$ notion dbs
id                                   │ title            │ url
─────────────────────────────────────┼──────────────────┼──────────────
a1b2c3d4-e5f6-7890-abcd-ef1234567890 │ Project Tracker  │ https://...
f9e8d7c6-b5a4-3210-fedc-ba0987654321 │ Reading List     │ https://...

2 results
```

### `notion search` — Search Everything

```
$ notion search "meeting"
```

### `notion users` / `notion user <id>` — Workspace Users

```
$ notion users
```

### `notion comments` / `notion comment` — Page Comments

```
$ notion comments tasks --filter "Name=Ship feature"
$ notion comment tasks "Shipped! 🚀" --filter "Name=Ship feature"
```

### `notion me` — Integration Identity

```
$ notion me
Bot: Stargazer
ID: 8fd93059-5e54-44a5-8efd-800069da9497
Type: bot
Owner: Workspace
```

### `notion props` — Quick Property Inspector

A fast way to inspect a single page's properties:

```
$ notion props tasks --filter "Name=Ship v1.1"
Page: a1b2c3d4-5678-90ab-cdef-1234567890ab
URL: https://www.notion.so/...
Name: Ship v1.1
Status: Done
Priority: High
Date: 2026-02-09
```

### `notion move` — Move Pages Between Databases

```bash
$ notion move tasks --filter "Name=Archived task" --to archive
✅ Moved page: a1b2c3d4…
   URL: https://notion.so/...
```

Accepts alias + filter for the source page, and an alias or page ID for `--to`.

### `notion templates` — List Database Templates

```bash
$ notion templates projects
id        │ title              │ url
──────────┼────────────────────┼──────────────────
a1b2c3d4… │ Project Template   │ https://notion.so/...
```

### `notion db-create` — Create a Database

```bash
$ notion db-create <parent-page-id> "My New DB" --prop "Name:title" --prop "Status:select" --prop "Priority:number"
✅ Created database: a1b2c3d4…
   Title: My New DB
   Properties: Name, Status, Priority
```

### `notion db-update` — Update Database Schema

Add or remove columns, rename databases:

```bash
$ notion db-update projects --add-prop "Rating:number" --add-prop "Category:select"
✅ Updated database: a1b2c3d4…
   Added: Rating:number, Category:select

$ notion db-update projects --remove-prop "Old Column"
✅ Updated database: a1b2c3d4…
   Removed: Old Column

$ notion db-update projects --title "Renamed Projects"
✅ Updated database: a1b2c3d4…
   Title: Renamed Projects
```

### `notion upload` — Upload Files to Pages

```bash
$ notion upload tasks --filter "Name=Ship feature" ./screenshot.png
✅ Uploaded: screenshot.png (142.3 KB)
   Page: a1b2c3d4…
```

Supports images, PDFs, text files, documents, and more. MIME types are detected automatically from file extensions.

### `notion alias` — Manage Aliases

Aliases are created automatically by `notion init`, but you can manage them:

```bash
notion alias list                              # See all aliases
notion alias rename project-tracker projects   # Rename one
notion alias add tasks <database-id>           # Add manually
notion alias remove tasks                      # Remove one
```

### `notion workspace` — Multi-Workspace Profiles

Manage multiple Notion accounts (work, personal, client projects):

```bash
# Add a workspace
notion workspace add work --key ntn_your_work_key
notion workspace add personal --key ntn_your_personal_key

# List workspaces
notion workspace list
#   default ← active
#     Key: ntn_3871... | Aliases: 5
#   work
#     Key: ntn_ab12... | Aliases: 0

# Switch active workspace
notion workspace use work

# Discover databases for a workspace
notion init --workspace work

# Per-command override (no switching needed)
notion query tasks --workspace personal
notion -w work add projects --prop "Name=Q2 Plan"

# Remove a workspace
notion workspace remove old-client
```

Aliases are scoped per workspace — same alias name in different workspaces won't collide. Old single-key configs are auto-migrated to a "default" workspace.

### `--json` — Raw JSON Output

Add `--json` to any command for the raw Notion API response:

```bash
notion --json query projects --limit 1
notion --json get tasks --filter "Name=Ship it"
```

Great for piping into `jq` or other tools.

### `--output` — Output Formats

```bash
notion query tasks --output csv     # CSV
notion query tasks --output yaml    # YAML
notion query tasks --output json    # JSON
notion query tasks --output table   # Default
```

---

## Use It With AI Agents

notioncli is designed to be fast for both humans and LLMs. AI coding agents can:

```bash
# Discover what's available
notion dbs
notion alias list

# Query and filter data
notion query tasks --filter Status=Todo --sort Priority:desc

# Create and update pages — zero UUIDs workflow
notion add tasks --prop "Name=Fix bug #42" --prop "Status=In Progress"
notion update tasks --filter "Name=Fix bug #42" --prop "Status=Done"

# Explore relations between databases
notion relations tasks --filter "Name=Fix bug #42"

# View and edit page content
notion blocks tasks --filter "Name=Fix bug #42" --ids
notion block-edit <block-id> "Updated content"
notion append tasks "Deployed to production" --filter "Name=Fix bug #42"

# Comment and collaborate
notion comment tasks "Shipped! 🚀" --filter "Name=Fix bug #42"

# Delete by alias + filter
notion delete tasks --filter "Name=Fix bug #42"

# Get raw JSON for parsing
notion --json query projects --limit 10
```

No API key management, no curl commands, no JSON formatting — just simple shell commands.

### Zero-UUID Workflow

Every page-targeted command (`update`, `delete`, `get`, `blocks`, `relations`, `comments`, `comment`, `append`, `block-edit`, `block-delete`) accepts a **database alias + `--filter`** as an alternative to a raw page ID:

```bash
# Instead of: notion update a1b2c3d4-5678-90ab-cdef-1234567890ab --prop "Status=Done"
# Just use:   notion update projects --filter "Name=Ship it" --prop "Status=Done"
```

The filter queries the database and expects **exactly one match**. If zero or multiple pages match, you get a clear error with guidance.

---

## Configuration

Config is stored at `~/.config/notioncli/config.json`:

```json
{
  "apiKey": "ntn_...",
  "aliases": {
    "projects": {
      "database_id": "a1b2c3d4-...",
      "data_source_id": "a1b2c3d4-..."
    }
  }
}
```

**API key resolution order:**
1. `NOTION_API_KEY` environment variable
2. Config file
3. Error with setup instructions

---

## Technical Notes

### Notion API 2025-09-03 — Dual IDs

The latest Notion API introduced a dual-ID system for databases. Each database now has both a `database_id` and a `data_source_id`. **notioncli handles this automatically** — when you add an alias, both IDs are discovered and stored. When you pass a raw UUID, it resolves correctly.

Additionally, the 2025 API moved property management from `databases` to `dataSources`. notioncli routes `db-create` and `db-update` property changes through `dataSources.update()` automatically — the old `databases.update()` endpoint silently ignores property modifications.

You don't need to think about this. It just works.

### Reliability

- 140 unit tests
- Tested against live Notion workspaces
- Designed to fail loudly and safely when filters match zero or multiple pages

### Built on the Official SDK

notioncli uses [`@notionhq/client`](https://github.com/makenotion/notion-sdk-js) v5.x, Notion's official JavaScript SDK.

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

### Development

```bash
git clone https://github.com/JordanCoin/notioncli.git
cd notioncli
npm install
export NOTION_API_KEY=ntn_your_test_key
node bin/notion.js --help
```

## License

MIT © [JordanCoin](https://github.com/JordanCoin)
