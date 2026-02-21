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
- [ ] **Result pagination** — 1000-row hard limit with just a "Truncated" badge; needs next/prev page or offset controls
- [ ] **Copy from results** — keyboard-driven copy of cell value or full row (Cmd/Ctrl+C on selection)

---

## P1 — Important for real use

- [ ] **Row editing** — click a cell to edit inline, write back via UPDATE; TablePlus's core UX
- [ ] **Schema tree: indexes + constraints + FKs** — currently only shows columns
- [ ] **Table browser mode** — browse a table with filter/sort UI without writing SQL
- [ ] **Query history timestamps** — history stores queries but not when they ran
- [ ] **Tab persistence** — reopen the app and your tabs/queries are still there
- [x] **Tab close backend cleanup** — `closeTab` now calls `cancel_query` + `disconnect`; cache cleared via `removeQueries([tabId])`
- [x] **Schema cache full invalidation on connect** — all tab-scoped keys are `[tabId, ...]`; connect and disconnect both call `removeQueries({ queryKey: [tabId] })` to nuke the full subtree

---

## P2 — Nice to have

- [ ] **MySQL/MariaDB support** — only Postgres + SQLite right now
- [ ] **SQLite PRAGMA identifier escaping** — table names with single-quotes or unusual characters break schema introspection; fix with double-quote wrapping
- [ ] **SSH tunnel support** — needed for connecting to remote/prod DBs safely
- [ ] **SQL formatter** — prettify/format the current query
- [ ] **EXPLAIN plan view** — visualize query execution plan
- [ ] **Search in results** — filter/find within a result set
- [ ] **Multiple result panes per tab** — run multiple queries and see all results
- [ ] **Connection groups/folders** — organize connections when you have many
- [ ] **Surface migration framework detection** — the backend detects Django/Rails/Prisma/etc. migrations but the UI doesn't use it yet
- [ ] **Project / team config UI** — `.dendron.toml` is parsed but not exposed in the UI

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
