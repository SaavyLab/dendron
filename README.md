# Dendron

A fast, keyboard-centric database client built with Rust and Tauri. Dendron prioritizes speed and zero-latency data rendering for the daily "connect, query, inspect" loop.

## Features

- **PostgreSQL & SQLite support** with encrypted credential storage (AES-256-GCM)
- **SSH tunneling** for remote and production database access
- **SQL editor** powered by CodeMirror 6 with syntax highlighting and context-aware autocomplete
- **Virtualized results table** that handles large result sets via TanStack Virtual
- **Multi-tab workspace** with per-tab connections and isolated state
- **Schema browser** with lazy-loaded tree (schemas, tables, columns)
- **Query safety checks** — destructive statements (DELETE, DROP, TRUNCATE) trigger a confirmation modal
- **Query cancellation** and history (last 100 queries, deduplicated)
- **Export** results to CSV or JSON, copy rows as INSERT statements
- **Resizable panels** — draggable splits between editor, results, and sidebar
- **Cell detail view** — inspect full untruncated values with JSON syntax highlighting
- **Result pagination** — load rows in batches of 1000
- **Migration framework detection** — recognizes Django, Rails, Prisma, Alembic, Flyway, and others

## Architecture

```
dendron/
├── dendron-core/      # Pure Rust engine — no Tauri dependencies
│   └── src/
│       ├── db/        # Connection pooling, Postgres, SQLite, SSH tunnels
│       ├── security/  # AES-256-GCM credential encryption
│       ├── query.rs   # Query analysis & destructive statement detection
│       └── ...
├── src-tauri/         # Thin Tauri 2.0 adapter (IPC commands, app state)
│   └── src/
│       ├── commands/  # connections, queries, schema, export, config
│       └── state.rs   # Tab-scoped state management
├── src/               # React + TypeScript frontend
│   ├── components/    # Editor, results table, schema tree, tabs, dialogs
│   ├── lib/           # Tauri API wrappers, workspace context, types
│   └── routes/        # TanStack Router
├── dev/               # Seed scripts and dev databases
└── docker-compose.yml # PostgreSQL 16 for local development
```

The core engine (`dendron-core`) is deliberately isolated from the UI layer so it can be reused with alternative frontends. The Tauri adapter is a thin translation layer between the core and the React frontend.

## Tech Stack

**Backend:** Rust, sqlx, tokio, sqlparser, russh, ring

**Frontend:** React 19, TypeScript, CodeMirror 6, TanStack (Router, Query, Table, Virtual), Tailwind CSS 4

**Desktop:** Tauri 2.0, Vite 7

**Package manager:** bun

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Bun](https://bun.sh/)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/) prerequisites for your platform
- Docker (optional, for local PostgreSQL)

## Getting Started

Install frontend dependencies:

```sh
bun install
```

Start the development PostgreSQL instance (optional):

```sh
docker compose up -d
```

The dev database connects at `localhost:5432` with user `dendron` / password `dendron` / database `dendron_dev`.

Seed a local SQLite database (optional):

```sh
bash dev/seed.sh
```

Run the app in development mode:

```sh
bun tauri dev
```

Build for production:

```sh
bun tauri build
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + Enter` | Execute query |
| `Cmd/Ctrl + C` | Copy selected cell value |
| `Escape` | Close cell detail panel |

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full tracking list. Key upcoming work:

- Command palette (`Cmd/Ctrl+P` fuzzy-finder)
- MySQL / MariaDB support
- Inline row editing
- Tab persistence across sessions
- EXPLAIN plan visualization

## IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
