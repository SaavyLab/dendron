//! Team configuration file support (.dendron.toml)

use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::env;
use crate::error::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TeamConfig {
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub connections: Vec<TeamConnection>,
    #[serde(default)]
    pub environments: HashMap<String, Vec<TeamConnection>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamConnection {
    pub name: String,
    #[serde(rename = "type")]
    pub conn_type: String,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub ssl_mode: Option<String>,
    #[serde(default)]
    pub requires_vpn: bool,
    #[serde(default)]
    pub connection_string: Option<String>,
}

impl TeamConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: TeamConfig = toml::from_str(&content)?;
        Ok(config)
    }

    pub fn find_and_load() -> Option<(PathBuf, Self)> {
        let cwd = env::current_dir().ok()?;
        Self::find_in_ancestors(&cwd)
    }

    pub fn find_in_ancestors(start: &Path) -> Option<(PathBuf, Self)> {
        let mut current = start.to_path_buf();
        loop {
            let config_path = current.join(".dendron.toml");
            if config_path.exists() {
                if let Ok(config) = Self::load(&config_path) {
                    return Some((config_path, config));
                }
            }
            if !current.pop() {
                break;
            }
        }
        None
    }

    pub fn all_connections(&self) -> Vec<&TeamConnection> {
        let mut all: Vec<&TeamConnection> = self.connections.iter().collect();
        for env_conns in self.environments.values() {
            all.extend(env_conns.iter());
        }
        all
    }

    pub fn connections_for_env(&self, env: &str) -> Vec<&TeamConnection> {
        self.environments
            .get(env)
            .map(|c| c.iter().collect())
            .unwrap_or_default()
    }
}

impl TeamConnection {
    pub fn resolve_env_vars(&self) -> Self {
        TeamConnection {
            name: self.name.clone(),
            conn_type: self.conn_type.clone(),
            environment: self.environment.clone(),
            description: self.description.clone(),
            path: self.path.as_ref().map(|s| resolve_env(s)),
            host: self.host.as_ref().map(|s| resolve_env(s)),
            port: self.port,
            database: self.database.as_ref().map(|s| resolve_env(s)),
            username: self.username.as_ref().map(|s| resolve_env(s)),
            password: self.password.as_ref().map(|s| resolve_env(s)),
            ssl_mode: self.ssl_mode.clone(),
            requires_vpn: self.requires_vpn,
            connection_string: self.connection_string.as_ref().map(|s| resolve_env(s)),
        }
    }

    pub fn is_complete(&self) -> bool {
        match self.conn_type.as_str() {
            "sqlite" => self.path.is_some(),
            "postgres" | "postgresql" => self.host.is_some() && self.database.is_some(),
            _ => false,
        }
    }
}

fn resolve_env(s: &str) -> String {
    let mut result = s.to_string();
    while let Some(start) = result.find("${") {
        if let Some(end) = result[start..].find('}') {
            let end = start + end;
            let var_name = &result[start + 2..end];
            let var_value = env::var(var_name).unwrap_or_default();
            result = format!("{}{}{}", &result[..start], var_value, &result[end + 1..]);
        } else {
            break;
        }
    }
    result
}
