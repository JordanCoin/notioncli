# notioncli

A powerful CLI for the Notion API — query databases, manage pages, and automate your workspace from the terminal.

```
npm install -g notioncli
```

## Setup

### 1. Create a Notion Integration

1. Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations)
2. Click **"New integration"**
3. Give it a name (e.g. "My CLI")
4. Copy the API key (starts with `ntn_`)

### 2. Share Databases

In Notion, open each database you want to access:
- Click the **•••** menu → **Connections** → Add your integration

### 3. Initialize the CLI

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

### 4. Add Aliases

```bash
notion alias add projects a1b2c3d4-e5f6-7890-abcd-ef1234567890
notion alias add reads f9e8d7c6-b5a4-3210-fedc-ba0987654321
```

Now use `projects` instead of the full ID everywhere.

> **Alternative:** Skip `init` and use an environment variable:
> ```bash
> export NOTION_API_KEY=ntn_your_api_key_here
> ```

## Commands

### List Databases

```
$ notion dbs
id                                   │ title            │ url
─────────────────────────────────────┼──────────────────┼──────────────
a1b2c3d4-e5f6-7890-abcd-ef1234567890 │ Project Tracker  │ https://...
f9e8d7c6-b5a4-3210-fedc-ba0987654321 │ Reading List     │ https://...
```

### Query a Database

Use an alias or a raw database ID:

```
$ notion query projects --filter Status=Active --sort Date:desc --limit 5
Date       │ Name          │ Status │ Priority
───────────┼───────────────┼────────┼─────────
2026-02-09 │ Launch CLI    │ Active │ High
2026-02-08 │ Write Docs    │ Active │ Medium

2 results
```

```
$ notion query a1b2c3d4-e5f6-7890-abcd-ef1234567890 --limit 10
```

### Add a Page

```
$ notion add projects --prop "Name=New Feature" --prop "Status=Todo" --prop "Date=2026-02-10"
✅ Created page: a1b2c3d4-...
   URL: https://www.notion.so/...
```

Properties are matched case-insensitively against the database schema. Supported types: title, rich_text, number, select, multi_select, date, checkbox, url, email, phone_number, status.

### Update a Page

```
$ notion update a1b2c3d4-5678-90ab-cdef-1234567890ab --prop "Status=Done" --prop "Priority=Low"
✅ Updated page: a1b2c3d4-...
```

### Delete (Archive) a Page

```
$ notion delete a1b2c3d4-5678-90ab-cdef-1234567890ab
🗑️  Archived page: a1b2c3d4-...
   (Restore it from the trash in Notion if needed)
```

### Get Page Details

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

### Get Page Content (Blocks)

```
$ notion blocks a1b2c3d4-5678-90ab-cdef-1234567890ab
# Project Overview
This is the main project page.
• First task
• Second task
☑ Completed item
☐ Pending item
```

### Search

```
$ notion search "meeting notes"
id                                   │ type        │ title          │ url
─────────────────────────────────────┼─────────────┼────────────────┼──────────────
a1b2c3d4-e5f6-7890-abcd-ef1234567890 │ page        │ Meeting Notes  │ https://...
f9e8d7c6-b5a4-3210-fedc-ba0987654321 │ data_source │ Meeting DB     │ https://...

2 results
```

### Manage Aliases

```bash
# List all aliases
notion alias list

# Add an alias
notion alias add tasks a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Remove an alias
notion alias remove tasks
```

### JSON Output

Add `--json` to any command for raw API output:

```bash
notion --json query projects --limit 1
notion --json get a1b2c3d4-...
```

## Configuration

Config is stored at `~/.config/notioncli/config.json`:

```json
{
  "apiKey": "ntn_...",
  "aliases": {
    "projects": {
      "database_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "data_source_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    }
  }
}
```

**API key resolution order:**
1. `NOTION_API_KEY` environment variable
2. Config file (`~/.config/notioncli/config.json`)
3. Error with setup instructions

## About Dual IDs (Notion API 2025-09-03)

The Notion API (version 2025-09-03) introduced a dual-ID system for databases:

- **`database_id`** — used for creating pages, retrieving schema
- **`data_source_id`** — used for querying rows

notioncli handles this automatically. When you add an alias, it discovers both IDs. When you pass a raw UUID, it works as both (the API resolves it).

The `@notionhq/client` v5.x SDK reflects this:
- `notion.dataSources.query()` replaces the old `notion.databases.query()`
- `notion.dataSources.retrieve()` gets database properties
- `notion.databases` namespace is for `create`, `update`, `retrieve` only

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
