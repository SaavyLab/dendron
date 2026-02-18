//! Project management

use std::path::{Path, PathBuf};
use crate::team_config::TeamConfig;
use crate::migrations::{MigrationFramework, FRAMEWORKS};

#[derive(Clone, Debug)]
pub struct Project {
    pub root: PathBuf,
    pub name: String,
    pub team_config: Option<TeamConfig>,
    pub team_config_path: Option<PathBuf>,
    pub detected_framework: Option<&'static MigrationFramework>,
    pub migrations_dir: Option<PathBuf>,
}

impl Project {
    pub fn open(path: impl AsRef<Path>) -> Option<Self> {
        let root = path.as_ref().to_path_buf();
        if !root.is_dir() {
            return None;
        }

        let name = root.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("project")
            .to_string();

        let config_path = root.join(".dendron.toml");
        let (team_config, team_config_path) = if config_path.exists() {
            match TeamConfig::load(&config_path) {
                Ok(config) => (Some(config), Some(config_path)),
                Err(e) => {
                    eprintln!("Warning: Failed to load .dendron.toml: {}", e);
                    (None, None)
                }
            }
        } else {
            (None, None)
        };

        let (detected_framework, migrations_dir) = detect_migrations_in_project(&root);

        Some(Self {
            root,
            name,
            team_config,
            team_config_path,
            detected_framework,
            migrations_dir,
        })
    }

    pub fn has_team_connections(&self) -> bool {
        self.team_config.as_ref()
            .map(|c| !c.connections.is_empty())
            .unwrap_or(false)
    }

    pub fn team_connections(&self) -> Vec<&crate::team_config::TeamConnection> {
        self.team_config.as_ref()
            .map(|c| c.all_connections())
            .unwrap_or_default()
    }

    pub fn has_migrations(&self) -> bool {
        self.detected_framework.is_some()
    }

    pub fn relative_path(&self, path: &Path) -> Option<PathBuf> {
        path.strip_prefix(&self.root).ok().map(|p| p.to_path_buf())
    }

    pub fn resolve_path(&self, relative: &Path) -> PathBuf {
        self.root.join(relative)
    }
}

fn detect_migrations_in_project(root: &Path) -> (Option<&'static MigrationFramework>, Option<PathBuf>) {
    for framework in FRAMEWORKS {
        if let Some(dir) = find_migration_dir(root, framework.migration_dir) {
            return (Some(framework), Some(dir));
        }
    }
    (None, None)
}

fn find_migration_dir(root: &Path, pattern: &str) -> Option<PathBuf> {
    if pattern.starts_with("*/") {
        let suffix = &pattern[2..];
        if let Ok(entries) = std::fs::read_dir(root) {
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
        let path = root.join(pattern);
        if path.is_dir() { Some(path) } else { None }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ProjectState {
    pub current: Option<Project>,
}

impl ProjectState {
    pub fn new() -> Self {
        Self { current: None }
    }

    pub fn open(&mut self, path: impl AsRef<Path>) -> bool {
        if let Some(project) = Project::open(path) {
            self.current = Some(project);
            true
        } else {
            false
        }
    }

    pub fn close(&mut self) {
        self.current = None;
    }

    pub fn is_open(&self) -> bool {
        self.current.is_some()
    }
}
