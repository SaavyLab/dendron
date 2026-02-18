//! Error types for the application

use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Failed to connect to database: {0}")]
    ConnectionFailed(String),
    #[error("Database connection timeout")]
    ConnectionTimeout,
    #[error("Query execution failed: {0}")]
    QueryFailed(String),
    #[error("Query was cancelled by user")]
    QueryCancelled,
    #[error("Invalid SQL syntax: {0}")]
    InvalidSql(String),
    #[error("Transaction error: {0}")]
    TransactionError(String),
    #[error("No active database connection")]
    NoConnection,
    #[error("Failed to load schema: {0}")]
    SchemaLoadFailed(String),
    #[error("Table '{0}' not found")]
    TableNotFound(String),
    #[error("Column '{0}' not found in table '{1}'")]
    ColumnNotFound(String, String),
    #[error("Failed to load configuration: {0}")]
    ConfigLoadFailed(String),
    #[error("Failed to save configuration: {0}")]
    ConfigSaveFailed(String),
    #[error("Configuration directory not found")]
    ConfigDirNotFound,
    #[error("Connection '{0}' not found in configuration")]
    ConnectionNotFound(String),
    #[error("Password encryption failed: {0}")]
    EncryptionFailed(String),
    #[error("Password decryption failed: {0}")]
    DecryptionFailed(String),
    #[error("Encryption key not found or invalid")]
    InvalidEncryptionKey,
    #[error("Failed to read file '{0}': {1}")]
    FileReadFailed(String, String),
    #[error("Failed to write file '{0}': {1}")]
    FileWriteFailed(String, String),
    #[error("Path does not exist: {0}")]
    PathNotFound(String),
    #[error("Failed to export to CSV: {0}")]
    CsvExportFailed(String),
    #[error("Failed to export to JSON: {0}")]
    JsonExportFailed(String),
    #[error("No results available to export")]
    NoResultsToExport,
    #[error("Tokio runtime error: {0}")]
    RuntimeError(String),
    #[error("Async task join error: {0}")]
    TaskJoinError(String),
    #[error("Invalid connection parameters: {0}")]
    InvalidConnectionParams(String),
    #[error("Invalid port number: {0}")]
    InvalidPort(String),
    #[error("Empty or invalid input: {0}")]
    InvalidInput(String),

    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Toml(#[from] toml::de::Error),
    #[error(transparent)]
    TomlSer(#[from] toml::ser::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Csv(#[from] csv::Error),
    #[error(transparent)]
    Base64(#[from] base64::DecodeError),
}

pub type Result<T> = std::result::Result<T, AppError>;

impl AppError {
    pub fn user_message(&self) -> String {
        match self {
            Self::ConnectionFailed(msg) => format!("Could not connect to database.\n\n{}", msg),
            Self::ConnectionTimeout => "Connection timed out.".to_string(),
            Self::QueryFailed(msg) => format!("Query execution failed.\n\n{}", msg),
            Self::QueryCancelled => "Query was cancelled.".to_string(),
            Self::InvalidSql(msg) => format!("Invalid SQL syntax.\n\n{}", msg),
            Self::NoConnection => "No database connection.".to_string(),
            Self::NoResultsToExport => "No results to export.".to_string(),
            _ => self.to_string(),
        }
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        Self::InvalidInput(s.to_string())
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        Self::InvalidInput(s)
    }
}
