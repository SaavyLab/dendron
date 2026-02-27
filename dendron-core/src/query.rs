//! Query analysis for detecting destructive statements using sqlparser

use sqlparser::dialect::{PostgreSqlDialect, SQLiteDialect, GenericDialect};
use sqlparser::parser::Parser;
use sqlparser::ast::{Statement, SetExpr, TableFactor, GroupByExpr};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum QueryType {
    Select,
    Insert,
    Update,
    Delete,
    Drop,
    Truncate,
    Alter,
    Create,
    Other,
}

impl QueryType {
    pub fn is_destructive(&self) -> bool {
        matches!(
            self,
            QueryType::Insert
                | QueryType::Update
                | QueryType::Delete
                | QueryType::Drop
                | QueryType::Truncate
                | QueryType::Alter
        )
    }

    pub fn risk_description(&self) -> &'static str {
        match self {
            QueryType::Delete => "DELETE will remove rows from the table",
            QueryType::Drop => "DROP will permanently delete the table/database",
            QueryType::Truncate => "TRUNCATE will remove ALL rows from the table",
            QueryType::Update => "UPDATE will modify existing data",
            QueryType::Insert => "INSERT will add new data",
            QueryType::Alter => "ALTER will modify the table structure",
            _ => "This query may modify data",
        }
    }
}

pub fn analyze_query(sql: &str) -> QueryType {
    let dialects: Vec<Box<dyn sqlparser::dialect::Dialect>> = vec![
        Box::new(PostgreSqlDialect {}),
        Box::new(SQLiteDialect {}),
        Box::new(GenericDialect {}),
    ];

    for dialect in dialects {
        if let Ok(statements) = Parser::parse_sql(dialect.as_ref(), sql) {
            if let Some(stmt) = statements.first() {
                return classify_statement(stmt);
            }
        }
    }

    analyze_query_fallback(sql)
}

fn classify_statement(stmt: &Statement) -> QueryType {
    match stmt {
        Statement::Query(_) => QueryType::Select,
        Statement::Insert(_) => QueryType::Insert,
        Statement::Update { .. } => QueryType::Update,
        Statement::Delete(_) => QueryType::Delete,
        Statement::Drop { .. } => QueryType::Drop,
        Statement::Truncate { .. } => QueryType::Truncate,
        Statement::AlterTable { .. } | Statement::AlterIndex { .. } => QueryType::Alter,
        Statement::CreateTable { .. }
        | Statement::CreateIndex { .. }
        | Statement::CreateView { .. }
        | Statement::CreateSchema { .. }
        | Statement::CreateDatabase { .. } => QueryType::Create,
        _ => QueryType::Other,
    }
}

fn analyze_query_fallback(sql: &str) -> QueryType {
    let trimmed = sql.trim();
    let first_word = trimmed
        .lines()
        .find(|line| !line.trim().starts_with("--"))
        .and_then(|line| line.split_whitespace().find(|word| !word.starts_with("--")))
        .map(|w| w.to_uppercase());

    match first_word.as_deref() {
        Some("SELECT") | Some("WITH") => QueryType::Select,
        Some("INSERT") => QueryType::Insert,
        Some("UPDATE") => QueryType::Update,
        Some("DELETE") => QueryType::Delete,
        Some("DROP") => QueryType::Drop,
        Some("TRUNCATE") => QueryType::Truncate,
        Some("ALTER") => QueryType::Alter,
        Some("CREATE") => QueryType::Create,
        _ => QueryType::Other,
    }
}

pub fn has_top_level_order_by(sql: &str) -> bool {
    let dialects: Vec<Box<dyn sqlparser::dialect::Dialect>> = vec![
        Box::new(PostgreSqlDialect {}),
        Box::new(SQLiteDialect {}),
        Box::new(GenericDialect {}),
    ];
    for dialect in dialects {
        if let Ok(statements) = Parser::parse_sql(dialect.as_ref(), sql) {
            return match statements.first() {
                Some(Statement::Query(q)) => q.order_by.is_some(),
                _ => true, // non-SELECT: no warning needed
            };
        }
    }
    true // parse failed: assume fine, no warning
}

pub fn analyze_multi_statement(sql: &str) -> Vec<QueryType> {
    let dialects: Vec<Box<dyn sqlparser::dialect::Dialect>> = vec![
        Box::new(PostgreSqlDialect {}),
        Box::new(SQLiteDialect {}),
        Box::new(GenericDialect {}),
    ];

    for dialect in dialects {
        if let Ok(statements) = Parser::parse_sql(dialect.as_ref(), sql) {
            return statements.iter().map(classify_statement).collect();
        }
    }

    vec![analyze_query_fallback(sql)]
}

pub fn most_dangerous_type(sql: &str) -> QueryType {
    let types = analyze_multi_statement(sql);
    if types.iter().any(|t| *t == QueryType::Drop) { return QueryType::Drop; }
    if types.iter().any(|t| *t == QueryType::Truncate) { return QueryType::Truncate; }
    if types.iter().any(|t| *t == QueryType::Delete) { return QueryType::Delete; }
    if types.iter().any(|t| *t == QueryType::Update) { return QueryType::Update; }
    if types.iter().any(|t| *t == QueryType::Alter) { return QueryType::Alter; }
    if types.iter().any(|t| *t == QueryType::Insert) { return QueryType::Insert; }
    if types.iter().any(|t| *t == QueryType::Create) { return QueryType::Create; }
    if types.iter().any(|t| *t == QueryType::Select) { return QueryType::Select; }
    QueryType::Other
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct QuerySafetyCheck {
    pub query_type: QueryType,
    pub is_dangerous_connection: bool,
    pub connection_name: String,
    pub requires_confirmation: bool,
}

impl QuerySafetyCheck {
    pub fn check(sql: &str, connection_name: &str, is_dangerous_connection: bool) -> Self {
        let query_type = most_dangerous_type(sql);
        let requires_confirmation = query_type.is_destructive() && is_dangerous_connection;
        Self {
            query_type,
            is_dangerous_connection,
            connection_name: connection_name.to_string(),
            requires_confirmation,
        }
    }

    pub fn warning_message(&self) -> String {
        format!(
            "You are about to execute a {} query on '{}'.\n\n{}",
            format!("{:?}", self.query_type).to_uppercase(),
            self.connection_name,
            self.query_type.risk_description()
        )
    }
}

// ── Editable result detection ──────────────────────────────────────────

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct EditableInfo {
    pub editable: bool,
    pub schema: Option<String>,
    pub table: Option<String>,
    pub reason: Option<String>,
}

impl EditableInfo {
    fn not_editable(reason: &str) -> Self {
        Self { editable: false, schema: None, table: None, reason: Some(reason.to_string()) }
    }
}

/// Analyse a SELECT to determine if its result set maps to a single base table
/// that can be UPDATEd.  Returns the schema + table if editable.
pub fn extract_source_table(sql: &str) -> EditableInfo {
    let dialects: Vec<Box<dyn sqlparser::dialect::Dialect>> = vec![
        Box::new(PostgreSqlDialect {}),
        Box::new(SQLiteDialect {}),
        Box::new(GenericDialect {}),
    ];

    for dialect in dialects {
        if let Ok(stmts) = Parser::parse_sql(dialect.as_ref(), sql) {
            if stmts.len() != 1 {
                return EditableInfo::not_editable("Multiple statements");
            }
            return match &stmts[0] {
                Statement::Query(q) => check_query_editable(q),
                _ => EditableInfo::not_editable("Not a SELECT query"),
            };
        }
    }

    EditableInfo::not_editable("Could not parse SQL")
}

fn check_query_editable(query: &sqlparser::ast::Query) -> EditableInfo {
    // No CTEs
    if query.with.is_some() {
        return EditableInfo::not_editable("Query uses CTEs");
    }

    // Body must be a plain SELECT (not UNION/INTERSECT/EXCEPT)
    let select = match query.body.as_ref() {
        SetExpr::Select(s) => s,
        _ => return EditableInfo::not_editable("Query uses set operations"),
    };

    // No DISTINCT
    if select.distinct.is_some() {
        return EditableInfo::not_editable("Query uses DISTINCT");
    }

    // No GROUP BY
    match &select.group_by {
        GroupByExpr::Expressions(exprs, _) if !exprs.is_empty() => {
            return EditableInfo::not_editable("Query uses GROUP BY");
        }
        GroupByExpr::All(_) => {
            return EditableInfo::not_editable("Query uses GROUP BY ALL");
        }
        _ => {}
    }

    // No HAVING
    if select.having.is_some() {
        return EditableInfo::not_editable("Query uses HAVING");
    }

    // Exactly one FROM, no JOINs
    if select.from.len() != 1 {
        return EditableInfo::not_editable("Query must have exactly one table in FROM");
    }
    let twj = &select.from[0];
    if !twj.joins.is_empty() {
        return EditableInfo::not_editable("Query uses JOINs");
    }

    // Must be a plain table reference (not subquery, function, etc.)
    let (schema, table) = match &twj.relation {
        TableFactor::Table { name, args, .. } => {
            // Table-valued function calls have Some(args)
            if args.is_some() {
                return EditableInfo::not_editable("FROM clause is a table-valued function");
            }
            let idents = &name.0;
            match idents.len() {
                1 => (None, idents[0].value.clone()),
                2 => (Some(idents[0].value.clone()), idents[1].value.clone()),
                n if n >= 3 => {
                    // catalog.schema.table — take last two
                    (Some(idents[n - 2].value.clone()), idents[n - 1].value.clone())
                }
                _ => return EditableInfo::not_editable("Could not parse table name"),
            }
        }
        _ => return EditableInfo::not_editable("FROM clause is not a simple table"),
    };

    EditableInfo {
        editable: true,
        schema,
        table: Some(table),
        reason: None,
    }
}

/// Quote a SQL identifier, escaping embedded double-quotes.
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
