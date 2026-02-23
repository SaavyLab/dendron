### Dendron: MVP & Architecture Blueprint

**The Core Philosophy:** A lightning-fast, TUI-inspired database client that wins on keyboard-centric speed and zero-latency data rendering. The UI is a disposable presentation layer, while all business logic remains strictly isolated in a pure Rust engine.

---

### Part 1: The MVP Feature Set

_The goal is workflow superiority over DataGrip/TablePlus, not feature parity. Ruthlessly prioritize the daily "connect, query, inspect" loop._

**1. Connection & Access (The Dealbreakers)**

- **Core Dialects:** Support for PostgreSQL, MySQL, and SQLite.
- **Networking:** Built-in SSH tunneling (mandatory for production/staging access).
- **Security:** Secure local storage of credentials and connection strings.

**2. Navigation (The "Open Anything" Loop)**

- **Command Palette:** TUI-style `Cmd/Ctrl+P` fuzzy-finder to instantly jump to any database, table, or view without lifting hands from the keyboard.
- **Schema Tree:** A fast, flat sidebar listing tables and views for visual browsing, avoiding deeply nested object explorers.

**3. The Data Grid (The Spreadsheet Experience)**

- **Speed:** Instant rendering of massive result sets via aggressive virtualization.
- **Inline Editing:** Double-click to edit a cell, with a `Cmd+S` batch-commit for `UPDATE` statements.
- **UI Filtering/Sorting:** Input fields above columns for quick filtering (e.g., `is null`, `contains`) without writing bespoke `SELECT` queries.

**4. The SQL Editor (The Developer Core)**

- **Execution:** `Cmd+Enter` to run a single statement under the cursor versus the entire script.
- **Workflow:** Multi-tab support for concurrent scratchpads and data views.
- **Autocomplete:** Basic, context-aware suggestions for table and column names.

**5. Essential I/O**

- **Export:** One-click export of data grid results to CSV and JSON.

---

### Part 2: The Performance Architecture (Tauri to GPUI)

_A defensive, scalable architecture that pushes Tauri 2.0 to its absolute limits while ensuring a frictionless pivot to GPUI when maximum bare-metal performance is eventually required._

**1. The Workspace Boundary (Strict Core Isolation)**
The Rust backend must remain entirely agnostic to the UI framework.

- `dendron-core`: A pure Rust crate (likely leveraging tools like `sqlx`) handling connection pooling, SSH tunnels, query execution, and caching. It accepts SQL strings and returns raw bytes or internal structs.
- `dendron-tauri`: A thin adapter crate that wraps the core. It manages the Tauri `AppHandle`, registers endpoints, and translates core errors into UI events.
- _The Pivot:_ When migrating to GPUI, `dendron-tauri` is deleted and replaced with `dendron-gpui`, leaving the core engine completely untouched.

**2. Zero-Serialization IPC (The Performance Engine)**
Bypass the V8 garbage collector and JSON serialization bottlenecks entirely.

- **Raw Payloads:** Utilize Tauri 2.0's raw IPC payloads to send pure binary data (`Vec<u8>`).
- **Binary Packing:** Pack query results in Rust using a fast binary format (e.g., FlatBuffers or `rkyv`). Send the byte array over IPC and read it directly in JavaScript using typed arrays (`Uint8Array`) for zero-copy deserialization.

**3. Aggressive DOM Virtualization**
The DOM must only render what is strictly visible.

- **Headless Windowing:** Use libraries like TanStack Virtual. The DOM should only contain the ~40 rows visible on screen, plus a tiny buffer.
- **DOM Recycling:** Instead of creating/destroying HTML elements on scroll, dynamically replace the data inside existing `<div>` elements with new data from the binary buffer.

**4. Non-Blocking Async Execution**
The UI must remain responsive even during hanging or massive queries.

- **Offload the Main Thread:** Tauri commands must never block. Use `tokio::spawn` to hand off heavy query execution and binary packing to a background worker pool.
- **Event-Driven Updates:** Commands immediately return a `query_id`. The frontend listens for an emitted event (e.g., `query_complete_{id}`) when the background thread finishes its work and the payload is ready to read.
