use crate::core::{config::Config, git::AutoCommit};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Session {
    pub root: PathBuf,
    pub watcher: notify::RecommendedWatcher,
    pub auto_commit: AutoCommit,
}

pub struct AppState {
    pub config_path: PathBuf,
    pub config: Mutex<Config>,
    pub session: Mutex<Option<Session>>,
}

impl AppState {
    pub fn root(&self) -> Result<PathBuf, String> {
        self.session.lock().unwrap().as_ref().map(|s| s.root.clone()).ok_or_else(|| "no vault open".to_string())
    }
    pub fn touch(&self) {
        if let Some(s) = self.session.lock().unwrap().as_ref() { s.auto_commit.touch(); }
    }
}
