//! Migration detection and introspection

use std::path::{Path, PathBuf};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct MigrationFramework {
    pub name: &'static str,
    pub table_name: &'static str,
    pub id_column: &'static str,
    pub name_column: Option<&'static str>,
    pub timestamp_column: Option<&'static str>,
    pub migration_dir: &'static str,
    pub file_pattern: &'static str,
}

pub static FRAMEWORKS: &[MigrationFramework] = &[
    MigrationFramework {
        name: "Django",
        table_name: "django_migrations",
        id_column: "id",
        name_column: Some("name"),
        timestamp_column: Some("applied"),
        migration_dir: "*/migrations",
        file_pattern: "*.py",
    },
    MigrationFramework {
        name: "Rails/ActiveRecord",
        table_name: "schema_migrations",
        id_column: "version",
        name_column: None,
        timestamp_column: None,
        migration_dir: "db/migrate",
        file_pattern: "*.rb",
    },
    MigrationFramework {
        name: "Prisma",
        table_name: "_prisma_migrations",
        id_column: "id",
        name_column: Some("migration_name"),
        timestamp_column: Some("finished_at"),
        migration_dir: "prisma/migrations",
        file_pattern: "migration.sql",
    },
    MigrationFramework {
        name: "Alembic",
        table_name: "alembic_version",
        id_column: "version_num",
        name_column: None,
        timestamp_column: None,
        migration_dir: "alembic/versions",
        file_pattern: "*.py",
    },
    MigrationFramework {
        name: "Flyway",
        table_name: "flyway_schema_history",
        id_column: "installed_rank",
        name_column: Some("description"),
        timestamp_column: Some("installed_on"),
        migration_dir: "db/migration",
        file_pattern: "V*.sql",
    },
    MigrationFramework {
        name: "Knex",
        table_name: "knex_migrations",
        id_column: "id",
        name_column: Some("name"),
        timestamp_column: Some("migration_time"),
        migration_dir: "migrations",
        file_pattern: "*.js",
    },
    MigrationFramework {
        name: "TypeORM",
        table_name: "migrations",
        id_column: "id",
        name_column: Some("name"),
        timestamp_column: Some("timestamp"),
        migration_dir: "src/migrations",
        file_pattern: "*.ts",
    },
    MigrationFramework {
        name: "Sequelize",
        table_name: "SequelizeMeta",
        id_column: "name",
        name_column: None,
        timestamp_column: None,
        migration_dir: "migrations",
        file_pattern: "*.js",
    },
    MigrationFramework {
        name: "Diesel",
        table_name: "__diesel_schema_migrations",
        id_column: "version",
        name_column: None,
        timestamp_column: Some("run_on"),
        migration_dir: "migrations",
        file_pattern: "*.sql",
    },
    MigrationFramework {
        name: "SQLx",
        table_name: "_sqlx_migrations",
        id_column: "version",
        name_column: Some("description"),
        timestamp_column: Some("installed_on"),
        migration_dir: "migrations",
        file_pattern: "*.sql",
    },
    MigrationFramework {
        name: "Goose",
        table_name: "goose_db_version",
        id_column: "id",
        name_column: None,
        timestamp_column: Some("tstamp"),
        migration_dir: "db/migrations",
        file_pattern: "*.sql",
    },
    MigrationFramework {
        name: "Laravel",
        table_name: "migrations",
        id_column: "id",
        name_column: Some("migration"),
        timestamp_column: None,
        migration_dir: "database/migrations",
        file_pattern: "*.php",
    },
];

#[derive(Debug, Clone)]
pub struct DetectedMigration {
    pub framework: String,
    pub table_name: String,
    pub id: String,
    pub name: Option<String>,
    pub applied_at: Option<String>,
    pub source_file: Option<PathBuf>,
}

#[derive(Debug, Clone, Default)]
pub struct MigrationDetectionResult {
    pub framework: Option<&'static MigrationFramework>,
    pub migrations: Vec<DetectedMigration>,
    pub migration_dir: Option<PathBuf>,
}

impl MigrationDetectionResult {
    pub fn has_migrations(&self) -> bool {
        self.framework.is_some()
    }
}

pub fn detect_framework(table_names: &[String]) -> Option<&'static MigrationFramework> {
    for framework in FRAMEWORKS {
        if table_names.iter().any(|t| t == framework.table_name) {
            return Some(framework);
        }
    }
    None
}

pub fn find_migration_files(project_root: &Path, framework: &MigrationFramework) -> HashMap<String, PathBuf> {
    let mut files = HashMap::new();
    let migration_dir = find_migration_dir(project_root, framework.migration_dir);

    if let Some(dir) = migration_dir {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    files.insert(name.to_string(), path.clone());
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        files.insert(stem.to_string(), path.clone());
                    }
                    let numeric_prefix: String = name.chars()
                        .take_while(|c| c.is_ascii_digit() || *c == '_')
                        .collect();
                    if !numeric_prefix.is_empty() {
                        files.insert(numeric_prefix.trim_end_matches('_').to_string(), path.clone());
                    }
                }
            }
        }
    }

    files
}

fn find_migration_dir(project_root: &Path, pattern: &str) -> Option<PathBuf> {
    if pattern.starts_with("*/") {
        let suffix = &pattern[2..];
        if let Ok(entries) = std::fs::read_dir(project_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let candidate = path.join(suffix);
                    if candidate.is_dir() {
                        return Some(candidate);
                    }
                }
            }
        }
        None
    } else {
        let path = project_root.join(pattern);
        if path.is_dir() { Some(path) } else { None }
    }
}
