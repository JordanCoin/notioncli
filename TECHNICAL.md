# Technical Notes

Deep dive into how notioncli works under the hood. You don't need any of this to use the CLI — it just works. This is for contributors and the curious.

## Notion API 2025-09-03 — Dual ID System

The 2025 API introduced a dual-ID system for databases:

| ID | What it's for | Example endpoint |
|----|---------------|-----------------|
| `database_id` | Page creation (`parent`), `databases.retrieve()` | `pages.create({ parent: { database_id } })` |
| `data_source_id` | Querying, schema, property management | `dataSources.query()`, `dataSources.retrieve()`, `dataSources.update()` |

When you run `notion init`, both IDs are discovered and stored per alias. When you pass a raw UUID, notioncli resolves which ID to use depending on the operation.

### The Silent Data Loss Bug

`databases.update()` silently ignores property changes in the 2025 API. It returns `200 OK` but drops all property modifications. You must use `dataSources.update()` for:

- Adding properties
- Removing properties
- Renaming properties

`databases.update()` still works for title changes only.

Similarly, `databases.create()` silently ignores non-title properties. notioncli handles this with a two-step approach:

1. Create the database with title via `databases.create()`
2. Add properties via `dataSources.update()`

### Where Schema Lives

```
databases.retrieve(database_id)     → NO properties field
dataSources.retrieve(data_source_id) → HAS properties field (this is the schema)
```

`getDbSchema()` in notioncli correctly uses `dataSources.retrieve()`.

### dataSources Methods

The `dataSources` namespace provides: `retrieve`, `query`, `create`, `update`, `listTemplates`.

## Architecture

### Modular Command Structure (v1.3.1)

`bin/notion.js` is a thin orchestrator (~28 lines). All logic lives in modules:

```
bin/notion.js          — CLI entry point, registers commands
lib/context.js         — Shared context factory (config, auth, Notion client, schema helpers)
lib/helpers.js         — Re-exports all lib modules
lib/format.js          — Output formatting (table, CSV, YAML, JSON), property building
lib/filters.js         — Filter parsing, operator detection, compound filters
lib/markdown.js        — Markdown ↔ Notion blocks, CSV parsing, inline formatting
lib/config.js          — Config load/save, workspace resolution
lib/paginate.js        — Cursor-based pagination
lib/retry.js           — Exponential backoff with jitter for rate limits
commands/config.js     — init, alias (add/remove/list/rename), workspace (add/list/use/remove)
commands/search.js     — search
commands/query.js      — query with filters, sorting, pagination
commands/crud.js       — add, update, delete, get
commands/blocks.js     — blocks, block-edit, block-delete, append
commands/database.js   — dbs, db-create, db-update, templates
commands/users.js      — users, user, me
commands/comments.js   — comments, comment
commands/pages.js      — relations, move, props
commands/import-export.js — import, export
commands/upload.js     — file upload
```

Each command module exports `register(program, ctx)` where `ctx` is the shared context from `createContext(program)`. The context provides config helpers, the lazy Notion client, schema resolution, and all formatting utilities.

### Alias Resolution

Every command that targets a database goes through `resolveDb(alias_or_id)`:

1. Check aliases in config (scoped to active workspace)
2. If UUID, return as-is (used as `data_source_id`)
3. If neither, error with helpful suggestion

### Filter → Page Resolution

Commands that target a single page (update, delete, get, etc.) use `resolvePageId()`:

1. If input is a UUID → return directly
2. If input is an alias → require `--filter`, query the database, expect exactly 1 result
3. Zero matches → error with "No pages found"
4. Multiple matches → error with "Multiple pages found, refine your filter"

### Dynamic Property Flags (v1.3+)

Commander.js `.allowUnknownOption()` lets unknown flags pass through. `extractDynamicProps()` parses raw `process.argv`:

1. Find flags starting with `--` that aren't in the known flags list
2. Convert `--kebab-case` to `Title Case` via `kebabToProperty()`
3. Match against database schema (case-insensitive)
4. Return as `Key=Value` pairs for property building

### Rich Filter Operators (v1.3+)

`parseFilterOperator()` splits filter strings by checking operators in order: `>=`, `<=`, `!=`, `>`, `<`, `=` (multi-char first to avoid false splits).

Relative dates (`today`, `yesterday`, `tomorrow`, `last_week`, `next_week`) are resolved to ISO date strings at parse time.

Multiple `--filter` flags combine with AND logic via `buildCompoundFilter()`.

### Pagination (v1.3.1)

`paginate()` in `lib/paginate.js` is a generic cursor-based pagination helper. It wraps any Notion API call that returns `{ results, has_more, next_cursor }` and accumulates all pages:

- Default behavior fetches all results (no limit)
- `--limit N` caps results and emits a stderr warning if truncated
- Used by: search, query, blocks, dbs, users, comments

### Rate Limit Retry (v1.3.1)

`withRetry()` in `lib/retry.js` wraps API calls with exponential backoff + jitter on 429 responses. The Notion client is wrapped via `wrapNotionClient()` which uses a JS Proxy to transparently intercept all method calls — no code changes needed per-endpoint.

Default: 5 attempts, 1s base delay, 2x multiplier, ±25% jitter.

### Input Validation (v1.3.1)

`buildPropValue()` in `lib/format.js` validates before hitting the API:

- **Numbers**: rejects NaN values
- **Dates**: validates against ISO 8601 (YYYY-MM-DD or full datetime) via regex + Date.parse
- **URLs**: requires `http://` or `https://` prefix
- **Emails**: requires `@` character

Returns `{ error: "..." }` objects; the caller prints a clear message and exits.

### Markdown ↔ Blocks

`markdownToBlocks()` parses: headings (h1-h3), bullet lists (with nested indentation via stack-based tracking), numbered lists, todo items, code blocks (fenced with language), blockquotes, dividers (`---`), and paragraphs with inline formatting (bold, italic, code, links).

`blocksToMarkdown()` reverses the process, preserving rich text annotations (bold → `**`, italic → `*`, code → backticks, strikethrough → `~~`, links → `[text](url)`) via `richTextToMarkdown()`.

### CSV Parsing (v1.3.1)

`parseCsv()` uses character-by-character scanning to correctly handle quoted fields containing newlines, commas, and escaped quotes (`""`). Previously split on `\n` which broke multiline fields.

### Multi-Workspace

Config format supports named workspace profiles:

```json
{
  "activeWorkspace": "default",
  "workspaces": {
    "default": { "apiKey": "ntn_...", "aliases": { ... } },
    "work": { "apiKey": "ntn_...", "aliases": { ... } }
  }
}
```

Old flat configs (`{ apiKey, aliases }`) are auto-migrated to `{ workspaces: { default: { apiKey, aliases } } }` on first load.

## Testing

213 tests across 27 suites, zero dependencies (`node:test` + `node:assert`):

- **`test/unit.test.js`** — Pure function tests (no API calls). Covers: property formatting (38 types), filter building (26 operators), markdown parsing (10 block types + nested bullets), CSV parsing (multiline fields), inline formatting, pagination, retry logic, input validation, dynamic prop extraction.
- **`test/mock.test.js`** — Command logic with mocked Notion client. Config management, filter building, schema resolution.
- **`test/integration.test.js`** — Live API tests (requires `NOTION_API_KEY`). Skipped in CI.

Run tests: `npm test`

## Built On

- [`@notionhq/client`](https://github.com/makenotion/notion-sdk-js) v5.x (official Notion SDK)
- [`commander`](https://github.com/tj/commander.js) for CLI parsing
- `node:test` + `node:assert` for testing (zero test dependencies)

## Contributing

```bash
git clone https://github.com/JordanCoin/notioncli.git
cd notioncli
npm install
export NOTION_API_KEY=ntn_your_test_key
npm test
node bin/notion.js --help
```
