//! Schema operations and SQL completions

use crate::db::schema::SchemaInfo;

pub struct SchemaOperations {
    completions: Vec<String>,
}

impl SchemaOperations {
    pub fn new() -> Self {
        Self { completions: Self::sql_keywords() }
    }

    fn sql_keywords() -> Vec<String> {
        vec![
            "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE", "BETWEEN",
            "ORDER", "BY", "ASC", "DESC", "LIMIT", "OFFSET", "GROUP", "HAVING",
            "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL", "CROSS", "ON",
            "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE",
            "TABLE", "INDEX", "VIEW", "DROP", "ALTER", "ADD", "COLUMN",
            "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE", "NULL",
            "DEFAULT", "CONSTRAINT", "CASCADE", "DISTINCT", "AS", "CASE",
            "WHEN", "THEN", "ELSE", "END", "COUNT", "SUM", "AVG", "MIN", "MAX",
            "COALESCE", "NULLIF", "CAST", "UNION", "ALL", "EXISTS", "ANY",
        ].into_iter().map(String::from).collect()
    }

    pub fn completions(&self) -> &Vec<String> {
        &self.completions
    }

    pub fn set_completions(&mut self, completions: Vec<String>) {
        self.completions = completions;
    }

    pub fn update_from_schemas(&mut self, schemas: &[SchemaInfo]) {
        let mut completions = Self::sql_keywords();
        for schema in schemas {
            for table in &schema.tables {
                completions.push(table.name.clone());
                completions.push(format!("{}.{}", schema.name, table.name));
                for col in &table.columns {
                    completions.push(col.name.clone());
                    completions.push(format!("{}.{}", table.name, col.name));
                }
            }
        }
        completions.sort();
        completions.dedup();
        self.completions = completions;
    }

    pub fn get_matches(&self, prefix: &str) -> Vec<&str> {
        if prefix.is_empty() {
            return Vec::new();
        }
        let prefix_lower = prefix.to_lowercase();
        self.completions
            .iter()
            .filter(|c| c.to_lowercase().starts_with(&prefix_lower))
            .map(|s| s.as_str())
            .take(10)
            .collect()
    }
}

impl Default for SchemaOperations {
    fn default() -> Self {
        Self::new()
    }
}
