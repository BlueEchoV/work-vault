use crate::core::vault::{Result, VaultError};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn cmd(root: &Path) -> Command {
    let mut c = Command::new("git");
    c.current_dir(root);
    c.env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; c.creation_flags(0x08000000); }
    c
}

pub(crate) fn run(root: &Path, args: &[&str]) -> Result<String> {
    let out = cmd(root).args(args).output().map_err(|e| VaultError::Git(format!("spawn git: {e}")))?;
    if !out.status.success() {
        return Err(VaultError::Git(String::from_utf8_lossy(&out.stderr).trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub fn available() -> bool { cmd(Path::new(".")).arg("--version").output().map(|o| o.status.success()).unwrap_or(false) }

const GITIGNORE: &str = ".vault-cache/\nThumbs.db\ndesktop.ini\n.DS_Store\n";

pub fn ensure_repo(root: &Path) -> Result<bool> {
    let gi = root.join(".gitignore");
    if !gi.exists() { std::fs::write(&gi, GITIGNORE)?; }
    if root.join(".git").is_dir() { return Ok(false); }
    run(root, &["init", "-q", "-b", "main"])?;
    run(root, &["config", "user.name"]).or_else(|_| run(root, &["config", "user.name", "Vault"]))?;
    run(root, &["config", "user.email"]).or_else(|_| run(root, &["config", "user.email", "vault@local"]))?;
    commit_all(root, "vault: initial commit")?;
    Ok(true)
}

pub fn status_count(root: &Path) -> Result<usize> {
    let s = run(root, &["status", "--porcelain", "--untracked-files=all"])?;
    Ok(s.lines().filter(|l| !l.trim().is_empty()).count())
}

pub fn commit_all(root: &Path, message: &str) -> Result<Option<String>> {
    run(root, &["add", "-A"])?;
    if status_count(root)? == 0 && run(root, &["diff", "--cached", "--quiet"]).is_ok() {
        // nothing staged; but an empty initial repo also has no HEAD, handle below
        if run(root, &["rev-parse", "--verify", "HEAD"]).is_ok() { return Ok(None); }
    }
    match run(root, &["commit", "-q", "-m", message]) {
        Ok(_) => Ok(Some(run(root, &["rev-parse", "HEAD"])?.trim().to_string())),
        Err(VaultError::Git(e)) if e.contains("nothing to commit") || e.contains("nothing added") => Ok(None),
        Err(e) => Err(e),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Commit { pub hash: String, pub short: String, pub date: String, pub message: String }

pub fn log_for(root: &Path, rel: Option<&str>, limit: usize) -> Result<Vec<Commit>> {
    let n = format!("-n{limit}");
    let mut args = vec!["log", &n, "--format=%H%x1f%h%x1f%cI%x1f%s"];
    if let Some(r) = rel { args.push("--follow"); args.push("--"); args.push(r); }
    let out = run(root, &args)?;
    Ok(out.lines().filter_map(|l| {
        let p: Vec<&str> = l.split('\u{1f}').collect();
        (p.len() == 4).then(|| Commit { hash: p[0].into(), short: p[1].into(), date: p[2].into(), message: p[3].into() })
    }).collect())
}

pub fn diff(root: &Path, hash: &str, rel: Option<&str>) -> Result<String> {
    let mut args = vec!["show", "--format=", "--no-color", hash];
    if let Some(r) = rel { args.push("--"); args.push(r); }
    run(root, &args)
}

/// Undoes one commit with a new commit (history is kept). Returns the new commit hash.
pub fn revert(root: &Path, hash: &str) -> Result<String> {
    if hash.len() < 7 || !hash.chars().all(|c| c.is_ascii_hexdigit()) { return Err(VaultError::Git(format!("not a commit hash: {hash}"))); }
    run(root, &["revert", "--no-edit", hash])?;
    Ok(run(root, &["rev-parse", "HEAD"])?.trim().to_string())
}

pub fn last_commit_iso(root: &Path) -> Result<Option<String>> {
    match run(root, &["log", "-1", "--format=%cI"]) {
        Ok(s) if !s.trim().is_empty() => Ok(Some(s.trim().to_string())),
        Ok(_) => Ok(None),
        Err(e) => Err(e),
    }
}

pub struct AutoCommit { deadline: Arc<Mutex<Option<Instant>>>, delay: Duration }

impl AutoCommit {
    pub fn new(root: PathBuf, delay_secs: u64, on_commit: Box<dyn Fn(String) + Send>) -> AutoCommit {
        let deadline = Arc::new(Mutex::new(None::<Instant>));
        let d2 = deadline.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(500));
            let due = { let mut g = d2.lock().unwrap(); match *g { Some(t) if Instant::now() >= t => { *g = None; true } _ => false } };
            if due {
                let n = status_count(&root).unwrap_or(0);
                if n == 0 { continue; }
                let msg = format!("auto: {} file{}", n, if n == 1 { "" } else { "s" });
                if let Ok(Some(h)) = commit_all(&root, &msg) { on_commit(h); }
            }
        });
        AutoCommit { deadline, delay: Duration::from_secs(delay_secs.max(1)) }
    }
    pub fn touch(&self) { *self.deadline.lock().unwrap() = Some(Instant::now() + self.delay); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        run(d.path(), &["config", "--global", "--get", "user.email"]).ok();
        assert!(ensure_repo(d.path()).unwrap());
        d
    }

    #[test]
    fn init_commit_log_diff() {
        let d = repo();
        assert!(d.path().join(".git").is_dir());
        assert!(d.path().join(".gitignore").is_file());
        assert_eq!(status_count(d.path()).unwrap(), 0);
        fs::write(d.path().join("a.md"), "one\n").unwrap();
        assert_eq!(status_count(d.path()).unwrap(), 1);
        let h = commit_all(d.path(), "auto: 1 file").unwrap();
        assert!(h.is_some());
        assert!(commit_all(d.path(), "nothing").unwrap().is_none());
        fs::write(d.path().join("a.md"), "one\ntwo\n").unwrap();
        commit_all(d.path(), "second").unwrap();
        let log = log_for(d.path(), Some("a.md"), 10).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].message, "second");
        let diff = diff(d.path(), &log[0].hash, Some("a.md")).unwrap();
        assert!(diff.contains("+two"));
        assert!(last_commit_iso(d.path()).unwrap().is_some());
        assert!(!ensure_repo(d.path()).unwrap(), "second ensure is a no-op");
    }

    #[test]
    fn log_for_on_non_repo_returns_error_not_panic() {
        let d = tempfile::tempdir().unwrap();
        assert!(log_for(d.path(), None, 5).is_err());
        assert!(status_count(d.path()).is_err());
    }

    #[test]
    fn auto_commit_fires_after_delay() {
        let d = repo();
        let fired = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let f2 = fired.clone();
        let ac = AutoCommit::new(d.path().to_path_buf(), 1, Box::new(move |h| f2.lock().unwrap().push(h)));
        fs::write(d.path().join("b.md"), "b").unwrap();
        ac.touch();
        ac.touch();
        std::thread::sleep(std::time::Duration::from_millis(2500));
        assert_eq!(fired.lock().unwrap().len(), 1);
        assert_eq!(status_count(d.path()).unwrap(), 0);
    }
}
