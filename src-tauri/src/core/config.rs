use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Config {
    pub vault_path: Option<PathBuf>,
    pub jira_base_url: Option<String>,
    pub auto_commit_secs: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self { vault_path: None, jira_base_url: None, auto_commit_secs: 30 }
    }
}

pub fn load(path: &Path) -> Config {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

pub fn save(path: &Path, cfg: &Config) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let s = serde_json::to_string_pretty(cfg).expect("config serializes");
    std::fs::write(path, s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_missing_file_gives_default() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = load(&dir.path().join("config.json"));
        assert_eq!(cfg, Config::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nested").join("config.json");
        let cfg = Config { vault_path: Some(PathBuf::from("C:/v")), jira_base_url: Some("https://j".into()), auto_commit_secs: 5 };
        save(&p, &cfg).unwrap();
        assert_eq!(load(&p), cfg);
    }

    #[test]
    fn load_corrupt_file_gives_default() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("config.json");
        std::fs::write(&p, "{not json").unwrap();
        assert_eq!(load(&p), Config::default());
    }
}
