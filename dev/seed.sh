#!/usr/bin/env bash
# Sets up the dendron dev databases.
# Usage: ./dev/seed.sh [--reset]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQLITE_DB="$SCRIPT_DIR/dendron_dev.sqlite"
RESET=false

for arg in "$@"; do
    [[ "$arg" == "--reset" ]] && RESET=true
done

echo "╔══════════════════════════════════════════╗"
echo "║    dendron dev database setup            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── SQLite ─────────────────────────────────────────────────
if ! command -v sqlite3 &>/dev/null; then
    echo "⚠  sqlite3 not found — skipping SQLite setup."
    echo "   Install with: sudo apt install sqlite3 / brew install sqlite"
else
    if [[ -f "$SQLITE_DB" ]]; then
        if [[ "$RESET" == true ]]; then
            echo "→ Removing existing SQLite DB (--reset)"
            rm "$SQLITE_DB"
        else
            echo "→ SQLite DB already exists. Run with --reset to recreate."
        fi
    fi

    if [[ ! -f "$SQLITE_DB" ]]; then
        echo "→ Creating SQLite database..."
        sqlite3 "$SQLITE_DB" < "$SCRIPT_DIR/sqlite-seed.sql"
        echo "✓ SQLite ready: $SQLITE_DB"
    fi
fi

echo ""

# ─── PostgreSQL ─────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    echo "⚠  docker not found — skipping PostgreSQL setup."
else
    echo "→ Starting PostgreSQL container..."

    if [[ "$RESET" == true ]]; then
        echo "→ Removing existing volume (--reset)"
        docker compose -f "$SCRIPT_DIR/../docker-compose.yml" down -v 2>/dev/null || true
    fi

    docker compose -f "$SCRIPT_DIR/../docker-compose.yml" up -d

    echo "→ Waiting for PostgreSQL to be ready..."
    for i in $(seq 1 20); do
        if docker exec dendron-postgres pg_isready -U dendron -d dendron_dev -q 2>/dev/null; then
            echo "✓ PostgreSQL ready"
            break
        fi
        if [[ $i -eq 20 ]]; then
            echo "✗ PostgreSQL did not become ready in time."
            exit 1
        fi
        sleep 1
    done
fi

echo ""
echo "─── Connection details for dendron ─────────────────────"
echo ""
echo "  PostgreSQL"
echo "    Host:     localhost"
echo "    Port:     5432"
echo "    User:     dendron"
echo "    Password: dendron"
echo "    Database: dendron_dev"
echo ""
echo "  SQLite"
echo "    Path:     $SQLITE_DB"
echo ""
echo "  Schemas (Postgres): public, analytics, inventory"
echo "  Tables (Postgres):  users, products, orders, order_items,"
echo "                      tags, audit_log, analytics.events,"
echo "                      analytics.sessions, analytics.daily_metrics,"
echo "                      analytics.feature_flags, inventory.warehouses,"
echo "                      inventory.stock_levels, inventory.movements"
echo ""
echo "  Tables (SQLite):    authors, posts, comments, categories,"
echo "                      tags, post_tags, media, site_settings,"
echo "                      page_views"
echo "────────────────────────────────────────────────────────"
