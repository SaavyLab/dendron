//! Application configuration

use crate::error::Result;
use crate::security::EncryptedPassword;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub connections: Vec<SavedConnection>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub last_connection: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub query_history: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub saved_queries: Vec<SavedQuery>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedQuery {
    pub name: String,
    pub query: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SavedConnection {
    #[serde(rename = "sqlite")]
    Sqlite {
        name: String,
        path: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        tags: Vec<String>,
    },
    #[serde(rename = "postgres")]
    Postgres {
        name: String,
        host: String,
        port: u16,
        username: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        password: Option<EncryptedPassword>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        password_plaintext: Option<String>,
        database: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        tags: Vec<String>,
    },
}

pub const TAG_PROD: &str = "prod";
pub const TAG_PRODUCTION: &str = "production";
pub const TAG_STAGING: &str = "staging";
pub const TAG_DEV: &str = "dev";
pub const TAG_LOCAL: &str = "local";
pub const TAG_SENSITIVE: &str = "sensitive";

impl SavedConnection {
    pub fn name(&self) -> &str {
        match self {
            SavedConnection::Sqlite { name, .. } => name,
            SavedConnection::Postgres { name, .. } => name,
        }
    }

    pub fn tags(&self) -> &[String] {
        match self {
            SavedConnection::Sqlite { tags, .. } => tags,
            SavedConnection::Postgres { tags, .. } => tags,
        }
    }

    pub fn is_dangerous(&self) -> bool {
        self.tags().iter().any(|t| {
            let lower = t.to_lowercase();
            lower == TAG_PROD || lower == TAG_PRODUCTION || lower == TAG_SENSITIVE
        })
    }

    pub fn has_tag(&self, tag: &str) -> bool {
        let lower = tag.to_lowercase();
        self.tags().iter().any(|t| t.to_lowercase() == lower)
    }

    pub fn get_password(&self) -> String {
        match self {
            SavedConnection::Sqlite { .. } => String::new(),
            SavedConnection::Postgres { password, password_plaintext, .. } => {
                if let Some(enc_pass) = password {
                    if let Ok(plaintext) = enc_pass.decrypt() {
                        return plaintext;
                    }
                }
                password_plaintext.clone().unwrap_or_default()
            }
        }
    }

    pub fn needs_password_migration(&self) -> bool {
        match self {
            SavedConnection::Sqlite { .. } => false,
            SavedConnection::Postgres { password, password_plaintext, .. } => {
                password.is_none() && password_plaintext.is_some()
            }
        }
    }

    pub fn migrate_password(&mut self) -> Result<()> {
        match self {
            SavedConnection::Postgres { password, password_plaintext, .. } => {
                if let Some(plaintext) = password_plaintext.take() {
                    if !plaintext.is_empty() {
                        *password = Some(EncryptedPassword::encrypt(&plaintext)?);
                    }
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub tree_width: f32,
    pub editor_height: f32,
    pub show_tree: bool,
    #[serde(default)]
    pub theme_name: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            tree_width: 200.0,
            editor_height: 160.0,
            show_tree: true,
            theme_name: None,
        }
    }
}

impl Config {
    pub fn config_dir() -> Option<PathBuf> {
        directories::ProjectDirs::from("", "", "dendron")
            .map(|dirs| dirs.config_dir().to_path_buf())
    }

    pub fn config_path() -> Option<PathBuf> {
        Self::config_dir().map(|dir| dir.join("config.toml"))
    }

    pub fn load() -> Self {
        Self::try_load().unwrap_or_default()
    }

    fn try_load() -> Result<Self> {
        let path = Self::config_path().ok_or(crate::error::AppError::ConfigDirNotFound)?;
        let contents = std::fs::read_to_string(&path)?;
        let config: Config = toml::from_str(&contents)?;
        Ok(config)
    }

    pub fn save(&self) -> Result<()> {
        let dir = Self::config_dir().ok_or(crate::error::AppError::ConfigDirNotFound)?;
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("config.toml");
        let contents = toml::to_string_pretty(self)?;
        std::fs::write(&path, contents)?;
        Ok(())
    }

    pub fn add_connection(&mut self, conn: SavedConnection) {
        self.connections.retain(|c| c.name() != conn.name());
        self.connections.push(conn);
    }

    pub fn remove_connection(&mut self, name: &str) {
        self.connections.retain(|c| c.name() != name);
    }
}
