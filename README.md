# notioncli

A powerful CLI for the Notion API — query databases, manage pages, and automate your workspace from the terminal.

**No more copy-pasting UUIDs.** Set up aliases once, then just type `notion query tasks` or `notion add projects --prop "Name=Ship it"`.

```bash
npm install -g notioncli
```

## Quick Start

```bash
# 1. Set your API key
notion init --key ntn_your_api_key_here

# 2. Add aliases for your databases
notion alias add projects a1b2c3d4-e5f6-7890-abcd-ef1234567890
notion alias add tasks f9e8d7c6-b5a4-3210-fedc-ba0987654321

# 3. Start using them
notion query projects
notion add tasks --prop "Name=Buy milk" --prop "Status=Todo"
```

That's it. You'll never type a database ID again.

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

This saves your key and discovers all shared databases:

```
✅ API key saved to ~/.config/notioncli/config.json

Found 3 databases:

  Project Tracker
    ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
    Add alias: notion alias add project-tracker a1b2c3d4-e5f6-7890-abcd-ef1234567890

  Reading List
    ID: f9e8d7c6-b5a4-3210-fedc-ba0987654321
    Add alias: notion alias add reading-list f9e8d7c6-b5a4-3210-fedc-ba0987654321

  Meeting Notes
    ID: 11223344-5566-7788-99aa-bbccddeeff00
    Add alias: notion alias add meeting-notes 11223344-5566-7788-99aa-bbccddeeff00
```

### 4. Add Your Aliases

Just copy-paste the suggested commands:

```bash
notion alias add projects a1b2c3d4-e5f6-7890-abcd-ef1234567890
notion alias add reads f9e8d7c6-b5a4-3210-fedc-ba0987654321
notion alias add meetings 11223344-5566-7788-99aa-bbccddeeff00
```

Done. Now use `projects`, `reads`, `meetings` everywhere instead of IDs.

> **Alternative:** Skip `init` and set an environment variable:
> ```bash
> export NOTION_API_KEY=ntn_your_api_key
> ```

---

## Commands

### `notion query` — Query a Database

The command you'll use most. Filter, sort, and browse your data:

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
Date       │ Name          │ Status │ Priority
───────────┼───────────────┼────────┼─────────
2026-02-09 │ Launch CLI    │ Active │ High
2026-02-08 │ Write Docs    │ Active │ Medium

2 results
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

```
$ notion update a1b2c3d4-5678-90ab-cdef-1234567890ab --prop "Status=Done" --prop "Priority=Low"
✅ Updated page: a1b2c3d4-...
```

### `notion delete` — Delete (Archive) a Page

```
$ notion delete a1b2c3d4-5678-90ab-cdef-1234567890ab
🗑️  Archived page: a1b2c3d4-...
   (Restore it from the trash in Notion if needed)
```

### `notion get` — View Page Details

```
$ notion get a1b2c3d4-5678-90ab-cdef-1234567890ab
Page: a1b2c3d4-5678-90ab-cdef-1234567890ab
URL:  https://www.notion.so/New-Feature-a1b2c3d4...
Created: 2026-02-10T14:30:00.000Z
Updated: 2026-02-10T14:30:00.000Z

Properties:
  Name: New Feature
  Status: Todo
  Date: 2026-02-10
  Priority: High
```

### `notion blocks` — View Page Content

```
$ notion blocks a1b2c3d4-5678-90ab-cdef-1234567890ab
# Project Overview
This is the main project page.
• First task
• Second task
☑ Completed item
☐ Pending item
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
id                                   │ type        │ title          │ url
─────────────────────────────────────┼─────────────┼────────────────┼──────────────
a1b2c3d4-e5f6-7890-abcd-ef1234567890 │ page        │ Meeting Notes  │ https://...
f9e8d7c6-b5a4-3210-fedc-ba0987654321 │ data_source │ Meetings DB    │ https://...

2 results
```

### `notion alias` — Manage Aliases

```bash
# See your aliases
notion alias list

# Add one (auto-discovers the right IDs)
notion alias add tasks a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Remove one
notion alias remove tasks
```

### `--json` — Raw JSON Output

Add `--json` to any command for the raw Notion API response:

```bash
notion --json query projects --limit 1
notion --json dbs
notion --json get a1b2c3d4-...
```

Great for piping into `jq` or other tools.

---

## Use It With AI Agents

notioncli is designed to be fast for both humans and LLMs. AI coding agents can:

```bash
# Discover what's available
notion dbs
notion alias list

# Query and filter data
notion query tasks --filter Status=Todo --sort Priority:desc

# Create and update pages
notion add tasks --prop "Name=Fix bug #42" --prop "Status=In Progress"
notion update <page-id> --prop "Status=Done"

# Get raw JSON for parsing
notion --json query projects --limit 10
```

No API key management, no curl commands, no JSON formatting — just simple shell commands.

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

You don't need to think about this. It just works.

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
