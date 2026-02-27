/**
 * Lightweight SQL statement splitting and cursor-to-statement mapping.
 *
 * Handles semicolon-delimited statements while respecting:
 *  - Single-quoted strings  ('it''s ok')
 *  - Double-quoted identifiers ("my table")
 *  - Dollar-quoted strings   ($tag$body$tag$)  — PostgreSQL
 *  - Single-line comments    (-- ...)
 *  - Block comments           (/* ... *​/)
 */

export interface SqlStatement {
  /** Trimmed SQL text of the statement. */
  text: string;
  /** Start offset in the original string (region start, inclusive). */
  from: number;
  /** End offset in the original string (region end, exclusive). */
  to: number;
}

/**
 * Split a SQL string into individual statements separated by semicolons.
 * Each statement owns a contiguous region [from, to) of the original string
 * so that the union of all regions covers the entire document.
 */
export function splitStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let regionStart = 0;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // ── Single-line comment ──
    if (ch === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }

    // ── Block comment ──
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      let depth = 1;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }

    // ── Single-quoted string ──
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2; // escaped quote
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          i++;
        }
      }
      continue;
    }

    // ── Double-quoted identifier ──
    if (ch === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          i += 2;
        } else if (sql[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
      continue;
    }

    // ── Dollar-quoted string (PostgreSQL) ──
    if (ch === "$") {
      const tagMatch = sql.slice(i).match(/^\$([A-Za-z_]*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const endIdx = sql.indexOf(tag, i + tag.length);
        if (endIdx !== -1) {
          i = endIdx + tag.length;
          continue;
        }
      }
    }

    // ── Semicolon — statement boundary ──
    if (ch === ";") {
      const regionEnd = i + 1;
      const text = sql.slice(regionStart, i).trim();
      if (text) {
        statements.push({ text, from: regionStart, to: regionEnd });
      }
      regionStart = regionEnd;
      i++;
      continue;
    }

    i++;
  }

  // Final statement (no trailing semicolon)
  const text = sql.slice(regionStart).trim();
  if (text) {
    statements.push({ text, from: regionStart, to: sql.length });
  }

  return statements;
}

/**
 * Derive a short label for a statement result sub-tab.
 * E.g. "SELECT (42 rows)", "INSERT (3 rows)", "CREATE TABLE".
 */
export function deriveStatementLabel(sql: string, result: import("./types").QueryResult): string {
  const firstWord = sql.trimStart().split(/[\s(]+/, 1)[0].toUpperCase();
  if (result.columns.length > 0) {
    return `${firstWord} (${result.row_count.toLocaleString()} row${result.row_count !== 1 ? "s" : ""})`;
  }
  if (result.affected_rows != null) {
    return `${firstWord} (${result.affected_rows.toLocaleString()} row${result.affected_rows !== 1 ? "s" : ""})`;
  }
  return firstWord;
}

/**
 * Find the statement that contains the given cursor offset.
 *
 * - If the offset falls within a statement's region, that statement is returned.
 * - If the offset is in empty space between statements, the next statement is returned.
 * - If past all statements, the last one is returned.
 */
export function statementAtOffset(
  statements: SqlStatement[],
  offset: number,
): SqlStatement | null {
  if (statements.length === 0) return null;

  for (const stmt of statements) {
    if (offset >= stmt.from && offset < stmt.to) {
      return stmt;
    }
  }

  // Cursor is past the last delimiter — return last statement
  return statements[statements.length - 1];
}
