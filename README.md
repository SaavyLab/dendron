# Dendron

A fast, native SQL client for PostgreSQL and SQLite. Built with Tauri, React, and Rust.

## Features

- **Multi-database support** — connect to PostgreSQL and SQLite databases
- **SSH tunneling** — reach remote databases through SSH with key or agent authentication
- **Schema browser** — explore schemas, tables, views, columns, indexes, and foreign keys in a sidebar tree
- **SQL editor** — write queries with syntax highlighting, autocomplete, and multi-statement support powered by CodeMirror
- **Virtualized results** — scroll through large result sets with a high-performance virtual table
- **Inline editing** — edit cell values directly in the results table for tables with primary keys
- **Multi-tab workspace** — open multiple query tabs with drag-to-reorder, each with its own connection
- **Command palette** — fuzzy-search connections, tables, and actions with `Cmd+P`
- **Query safety checks** — destructive statements (DELETE, DROP, TRUNCATE, UPDATE, ALTER) trigger a confirmation before executing
- **Export** — save results as CSV or JSON, or copy a row as an INSERT statement
- **Query history** — automatically records executed queries for later reference
- **Environment tags** — label connections as Production, Staging, Dev, or Local with color-coded badges
- **Keyboard-driven** — extensive shortcuts for running queries, managing tabs, navigating results, and more

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | [Tauri 2](https://tauri.app/) |
| Frontend | [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS 4](https://tailwindcss.com/) |
| Build tooling | [Vite 7](https://vite.dev/), [Bun](https://bun.sh/) |
| SQL editor | [CodeMirror 6](https://codemirror.net/) |
| Routing / data | [TanStack Router](https://tanstack.com/router), [TanStack Query](https://tanstack.com/query), [TanStack Table](https://tanstack.com/table) |
| Backend core | Rust, [SQLx](https://github.com/launchbadge/sqlx), [sqlparser](https://github.com/sqlparser-rs/sqlparser-rs) |
| SSH | [russh](https://github.com/warp-tech/russh) |

## Project Structure

```
dendron/
├── src/                  # React frontend
│   ├── components/       # UI components (editor, results table, schema tree, etc.)
│   ├── lib/              # Shared utilities, Tauri API bindings, types
│   └── routes/           # TanStack Router route definitions
├── src-tauri/            # Tauri application shell
│   └── src/
│       ├── commands/     # IPC command handlers (connections, queries, schema, export, config)
│       └── state.rs      # Application state management
└── dendron-core/         # Rust library crate
    └── src/
        ├── db/           # Database drivers (postgres, sqlite, ssh tunneling)
        ├── query.rs      # SQL parsing and safety analysis
        ├── schema_ops.rs # Schema introspection
        ├── security/     # Credential encryption
        └── config.rs     # User settings persistence
```

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Bun](https://bun.sh/)
- Tauri 2 system dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

## Getting Started

```bash
# Install frontend dependencies
bun install

# Run in development mode (launches both the Vite dev server and the Tauri window)
bun run tauri dev

# Build a production bundle
bun run tauri build
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Enter` | Run query at cursor |
| `Cmd+Shift+Enter` | Run all queries |
| `Escape` | Cancel running query |
| `Cmd+T` | New tab |
| `Cmd+W` | Close tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Cmd+P` | Command palette |
| `Cmd+K` | Keyboard shortcuts reference |
| `Cmd+[` / `Cmd+]` | Previous / next result sub-tab |
| `Cmd+C` | Copy selected cell or row |

## License

This project is proprietary software. All rights reserved.
