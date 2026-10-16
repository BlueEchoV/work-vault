use crate::core::vault::{is_hidden_dir, to_rel};
use notify::{EventKind, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

fn ignored(root: &Path, p: &Path) -> bool {
    p.strip_prefix(root).ok().map(|r| r.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        s == ".git" || s == ".vault-cache" || s == "node_modules"
    })).unwrap_or(true)
}

/// Starts watching; calls `on_change` with debounced (300 ms) batches of changed rel paths.
pub fn start(root: PathBuf, on_change: Box<dyn Fn(Vec<String>) + Send>) -> notify::Result<notify::RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) {
                for p in ev.paths { let _ = tx.send(p); }
            }
        }
    })?;
    w.watch(&root, RecursiveMode::Recursive)?;
    std::thread::spawn(move || {
        loop {
            let first = match rx.recv() { Ok(p) => p, Err(_) => break };
            let mut batch = vec![first];
            let deadline = std::time::Instant::now() + Duration::from_millis(300);
            while let Ok(p) = rx.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) { batch.push(p); }
            let mut rels: Vec<String> = batch.into_iter().filter(|p| !ignored(&root, p)).map(|p| to_rel(&root, &p)).collect();
            rels.sort(); rels.dedup();
            rels.retain(|r| !r.split('/').any(|seg| is_hidden_dir(seg) && seg != "assets"));
            if !rels.is_empty() { on_change(rels); }
        }
    });
    Ok(w)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_changed_rels_and_skips_git_dir() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".git")).unwrap();
        let (tx, rx) = std::sync::mpsc::channel::<Vec<String>>();
        let _w = start(d.path().to_path_buf(), Box::new(move |rels| { let _ = tx.send(rels); })).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        std::fs::write(d.path().join(".git/index"), "x").unwrap();
        std::fs::write(d.path().join("a.md"), "hello").unwrap();
        let got = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert!(got.contains(&"a.md".to_string()), "got {got:?}");
        assert!(!got.iter().any(|r| r.starts_with(".git")), "got {got:?}");
    }
}
