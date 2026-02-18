use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TransactionState {
    #[default]
    Idle,
    InTransaction,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConnectionConfig {
    Postgres {
        name: String,
        host: String,
        port: u16,
        database: String,
        username: String,
        password: String,
    },
    Sqlite {
        name: String,
        path: PathBuf,
    },
}

impl ConnectionConfig {
    pub fn name(&self) -> &str {
        match self {
            ConnectionConfig::Postgres { name, .. } => name,
            ConnectionConfig::Sqlite { name, .. } => name,
        }
    }

    pub fn connection_string(&self) -> String {
        match self {
            ConnectionConfig::Postgres { host, port, database, username, password, .. } => {
                format!("postgres://{}:{}@{}:{}/{}", username, password, host, port, database)
            }
            ConnectionConfig::Sqlite { path, .. } => {
                format!("sqlite:{}", path.display())
            }
        }
    }
}

#[derive(Debug, Clone)]
pub enum DatabaseConnection {
    Postgres(sqlx::PgPool),
    Sqlite(sqlx::SqlitePool),
}

impl DatabaseConnection {
    pub async fn connect(config: &ConnectionConfig) -> Result<Self> {
        match config {
            ConnectionConfig::Postgres { .. } => {
                let pool = sqlx::PgPool::connect(&config.connection_string()).await?;
                Ok(DatabaseConnection::Postgres(pool))
            }
            ConnectionConfig::Sqlite { path, .. } => {
                let conn_str = format!("sqlite:{}?mode=rwc", path.display());
                let pool = sqlx::SqlitePool::connect(&conn_str).await?;
                Self::init_demo_sqlite(&pool).await?;
                Ok(DatabaseConnection::Sqlite(pool))
            }
        }
    }

    async fn init_demo_sqlite(pool: &sqlx::SqlitePool) -> Result<()> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )"
        ).execute(pool).await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id),
                amount REAL NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )"
        ).execute(pool).await?;

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
            .fetch_one(pool).await?;

        if count.0 == 0 {
            sqlx::query("INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')").execute(pool).await?;
            sqlx::query("INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')").execute(pool).await?;
            sqlx::query("INSERT INTO users (name, email) VALUES ('Charlie', 'charlie@example.com')").execute(pool).await?;
            sqlx::query("INSERT INTO orders (user_id, amount, status) VALUES (1, 99.99, 'completed')").execute(pool).await?;
            sqlx::query("INSERT INTO orders (user_id, amount, status) VALUES (1, 149.50, 'pending')").execute(pool).await?;
            sqlx::query("INSERT INTO orders (user_id, amount, status) VALUES (2, 25.00, 'completed')").execute(pool).await?;
        }

        Ok(())
    }

    pub async fn test_connection(config: &ConnectionConfig) -> Result<()> {
        let conn = Self::connect(config).await?;
        match conn {
            DatabaseConnection::Postgres(pool) => { sqlx::query("SELECT 1").execute(&pool).await?; }
            DatabaseConnection::Sqlite(pool) => { sqlx::query("SELECT 1").execute(&pool).await?; }
        }
        Ok(())
    }

    pub async fn begin_transaction(&self) -> Result<()> {
        match self {
            DatabaseConnection::Postgres(pool) => { sqlx::query("BEGIN").execute(pool).await?; }
            DatabaseConnection::Sqlite(pool) => { sqlx::query("BEGIN").execute(pool).await?; }
        }
        Ok(())
    }

    pub async fn commit(&self) -> Result<()> {
        match self {
            DatabaseConnection::Postgres(pool) => { sqlx::query("COMMIT").execute(pool).await?; }
            DatabaseConnection::Sqlite(pool) => { sqlx::query("COMMIT").execute(pool).await?; }
        }
        Ok(())
    }

    pub async fn rollback(&self) -> Result<()> {
        match self {
            DatabaseConnection::Postgres(pool) => { sqlx::query("ROLLBACK").execute(pool).await?; }
            DatabaseConnection::Sqlite(pool) => { sqlx::query("ROLLBACK").execute(pool).await?; }
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct ConnectionManager {
    pub connections: Vec<ConnectionConfig>,
    pub active_connection: Option<DatabaseConnection>,
    pub active_index: Option<usize>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_connection(&mut self, config: ConnectionConfig) {
        self.connections.push(config);
    }

    pub async fn connect(&mut self, index: usize) -> Result<()> {
        if let Some(config) = self.connections.get(index) {
            let conn = DatabaseConnection::connect(config).await?;
            self.active_connection = Some(conn);
            self.active_index = Some(index);
        }
        Ok(())
    }

    pub fn active_config(&self) -> Option<&ConnectionConfig> {
        self.active_index.and_then(|i| self.connections.get(i))
    }
}
