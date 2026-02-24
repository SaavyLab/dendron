# Dendron Roadmap

Tracking what needs to happen before dendron can replace TablePlus/DataGrip as a daily driver.

---

## P0 — Daily driver blockers

These are friction points you'd hit constantly. Do these first.

- [x] **Resizable editor/results split** — draggable vertical and horizontal panel splits via react-resizable-panels
- [x] **SQL autocomplete** — context-aware via `@codemirror/lang-sql` schema option + Compartment; schema fetched once on connect
- [x] **Remove SQLite demo seeding from app** — `init_demo_sqlite()` was silently mutating user DBs on every connect; dev data lives in seed scripts
- [x] **Fix safety confirmation DB type** — `check_query_safety` was passing hardcoded `false`/`"current"`, so the destructive-query modal was never shown; now passes real dialect and connected state
- [x] **Result streaming with row cap** — replaced `fetch_all` with a `fetch()` stream that breaks at 1001 rows, capping memory at `DEFAULT_ROW_LIMIT + 1` rows regardless of table size
- [x] **Non-text column type decoding** — timestamps (TIMESTAMP/TIMESTAMPTZ→RFC3339/ISO), UUIDs, SMALLINT, FLOAT4, NUMERIC/DECIMAL, BYTEA/BLOB (hex), INET/CIDR (dotted-decimal or colon-hex + prefix), MACADDR/MACADDR8; custom enum/domain types decoded via wire bytes; unknown types show `<type_name>`
- [x] **Cell detail view** — click any cell to open a bottom panel with the full untruncated value, column name + type badge, copy button, ESC to close; panel is resizable (drag top border); JSONB/JSON values get syntax highlighting (keys, strings, numbers, booleans, null); clicking a cell auto-scrolls it into view
- [x] **Result pagination** — "Load more" appends next 1000 rows; SELECT queries wrapped with LIMIT/OFFSET; "No ORDER BY" drift warning badge
- [x] **Copy from results** — Cmd/Ctrl+C copies selected cell value when no text is highlighted; export CSV/JSON use native OS save dialog via tauri-plugin-dialog
- [ ] **SSH tunnel support** — needed for connecting to remote/prod DBs; without this you can't reach any staging or production database safely

---

## P1 — Important for real use

- [ ] **Command palette** — `Cmd/Ctrl+P` fuzzy-finder to jump to any database, table, or view without touching the mouse; the "open anything" loop
- [ ] **Custom right-click context menus** — override the default browser/webview context menu everywhere; results table (copy cell, copy row as JSON/CSV, copy as INSERT), schema tree (copy table name, generate SELECT, inspect), editor (format, explain); own the full UX surface
- [ ] **Row editing** — click a cell to edit inline, write back via UPDATE; TablePlus's core UX
- [ ] **MySQL/MariaDB support** — only Postgres + SQLite right now; MySQL is too common to leave out
- [x] **Schema tree: indexes + constraints + FKs** — Columns/Indexes/Keys sub-groups via `describe_table`; each collapsible; indexes show pk/unique/idx badge, FKs show referenced table
- [ ] **Theming system** — runtime-swappable named themes via CSS custom properties; all colors already go through `:root` vars so the plumbing is nearly free; needs a `themes.ts` definition file, a theme-picker UI (likely inside settings or command palette), and persistence via the existing `theme_name` field in `Settings`
- [ ] **Table browser mode** — browse a table with filter/sort UI without writing SQL
- [ ] **Query history timestamps** — history stores queries but not when they ran
- [ ] **Tab persistence** — reopen the app and your tabs/queries are still there
- [x] **Tab close backend cleanup** — `closeTab` now calls `cancel_query` + `disconnect`; cache cleared via `removeQueries([tabId])`
- [x] **Schema cache full invalidation on connect** — all tab-scoped keys are `[tabId, ...]`; connect and disconnect both call `removeQueries({ queryKey: [tabId] })` to nuke the full subtree

---

## P2 — Nice to have

- [ ] **SQLite PRAGMA identifier escaping** — table names with single-quotes or unusual characters break schema introspection; fix with double-quote wrapping
- [ ] **SQL formatter** — prettify/format the current query
- [ ] **EXPLAIN plan view** — visualize query execution plan
- [ ] **Search in results** — filter/find within a result set
- [ ] **Multiple result panes per tab** — run multiple queries and see all results
- [ ] **Connection groups/folders** — organize connections when you have many
- [ ] **Surface migration framework detection** — the backend detects Django/Rails/Prisma/etc. migrations but the UI doesn't use it yet
- [ ] **Project / team config UI** — `.dendron.toml` is parsed but not exposed in the UI

---

## Architecture decisions

These are locked-in choices that shape the long-term codebase. Document them here so we don't relitigate them.

### Crate split: `dendron-core` + `dendron-tauri` (planned, not yet implemented)

The Rust backend will be split into two sibling crates at the repo root:

- **`dendron-core/`** — pure Rust, zero Tauri dependencies; owns connection pooling, SSH tunnels, query execution, schema introspection, type decoding, caching. Accepts SQL strings, returns internal structs. Usable from any future host (GPUI, MCP server, CLI).
- **`src-tauri/`** (becomes `dendron-tauri`) — thin adapter; registers Tauri commands, translates core errors into UI events, owns `AppHandle`. `AppState` → `Workspace` rename to reflect that it's no longer Tauri-specific.

**Why do it now:** the codebase is small, the split is cheap, and the GPUI pivot is very likely. At that point `dendron-tauri` is deleted entirely and replaced with `dendron-gpui` — the core engine is untouched. Doing the split after the codebase grows would be significantly more painful.

**Pivot path:** delete `src-tauri/`, add `dendron-gpui/`, wire `dendron-core` through GPUI primitives. No changes to core query/type/schema logic.

### Binary IPC: explicitly skipped

Tauri 2.0 supports raw `Vec<u8>` IPC + FlatBuffers/rkyv for zero-copy JS deserialization. **We are not doing this.** Reasons:

1. JSON serialization costs ~5ms on large result sets — the database round-trip is 100-1000x that.
2. It is a Tauri-phase-only optimization: when we pivot to GPUI there is no IPC layer at all (Rust renders directly). Any binary IPC work gets deleted wholesale.
3. The real rendering bottleneck is DOM virtualization, which TanStack Virtual already handles.

If performance profiling ever reveals IPC as a real bottleneck, revisit. Until then, JSON IPC is correct.

---

## In progress / done

- [x] Multi-tab workspace with per-tab connections
- [x] Postgres + SQLite support with encrypted password storage
- [x] CodeMirror editor with SQL syntax highlighting and custom theme
- [x] Virtualized results table (handles large result sets)
- [x] Schema tree (schema → table → columns, lazy loaded)
- [x] Query cancellation
- [x] Safety confirmation for destructive queries (tag-based: `prod`/`production`/`sensitive` connections require confirmation)
- [x] Tab-scoped state via `TabContext` — single map owns connection Arc, cancel token, and query generation counter; no mutex held across `.await`
- [x] Concurrent query guard — `runActiveQuery` returns early when `tab.isRunning`
- [x] Query history (last 100, deduplicated)
- [x] CSV + JSON export
- [x] Migration framework detection (Django, Rails, Prisma, Alembic, Flyway, etc.)
