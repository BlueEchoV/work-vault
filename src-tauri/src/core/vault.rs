use crate::core::frontmatter;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("path escapes vault: {0}")] Escape(String),
    #[error("already exists: {0}")] Exists(String),
    #[error("not found: {0}")] NotFound(String),
    #[error("still referenced by {0:?}")] Referenced(Vec<String>),
    #[error("git: {0}")] Git(String),
}
pub type Result<T> = std::result::Result<T, VaultError>;

const HIDDEN: &[&str] = &[".git", ".claude", ".vault-cache", "assets", "raw", "node_modules"];
pub fn is_hidden_dir(name: &str) -> bool { HIDDEN.contains(&name) }

pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let rel = rel.replace('\\', "/");
    let p = Path::new(&rel);
    if p.is_absolute() || p.has_root() {
        return Err(VaultError::Escape(rel));
    }
    for c in p.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(VaultError::Escape(rel)),
        }
    }
    Ok(root.join(p))
}

pub fn to_rel(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root).unwrap_or(abs).to_string_lossy().replace('\\', "/")
}

#[derive(Debug, Clone, Serialize)]
pub struct TreeNode {
    pub name: String,
    pub rel: String,
    pub kind: String,
    pub note_type: Option<String>,
    pub children: Vec<TreeNode>,
}

pub fn list_tree(root: &Path) -> Result<TreeNode> {
    fn walk(root: &Path, dir: &Path) -> Result<Vec<TreeNode>> {
        let mut dirs = Vec::new();
        let mut files = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            let rel = to_rel(root, &path);
            if path.is_dir() {
                if is_hidden_dir(&name) || name.starts_with('.') { continue; }
                dirs.push(TreeNode { name, rel, kind: "dir".into(), note_type: None, children: walk(root, &path)? });
            } else if name.ends_with(".md") {
                let note_type = Some(frontmatter::infer_type(&rel).to_string());
                files.push(TreeNode { name, rel, kind: "note".into(), note_type, children: vec![] });
            }
        }
        let key = |n: &TreeNode| n.name.to_lowercase();
        dirs.sort_by_key(key);
        files.sort_by_key(key);
        dirs.extend(files);
        Ok(dirs)
    }
    Ok(TreeNode { name: String::new(), rel: String::new(), kind: "dir".into(), note_type: None, children: walk(root, root)? })
}

#[derive(Debug, Clone, Serialize)]
pub struct Note {
    pub rel: String,
    pub content: String,
    pub meta: serde_json::Value,
    pub note_type: String,
    pub mtime_ms: u64,
}

fn mtime_ms(p: &Path) -> u64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn read_note(root: &Path, rel: &str) -> Result<Note> {
    let p = resolve(root, rel)?;
    if !p.is_file() { return Err(VaultError::NotFound(rel.into())); }
    let content = std::fs::read_to_string(&p)?;
    let parsed = frontmatter::parse(&content);
    let rel = to_rel(root, &p);
    let note_type = parsed.meta.get("type").and_then(|v| v.as_str()).map(String::from)
        .unwrap_or_else(|| frontmatter::infer_type(&rel).to_string());
    Ok(Note { rel, content, meta: parsed.meta, note_type, mtime_ms: mtime_ms(&p) })
}

pub fn write_note(root: &Path, rel: &str, content: &str) -> Result<u64> {
    let p = resolve(root, rel)?;
    if let Some(parent) = p.parent() { std::fs::create_dir_all(parent)?; }
    std::fs::write(&p, content)?;
    Ok(mtime_ms(&p))
}

pub fn create_note(root: &Path, rel: &str, content: &str) -> Result<()> {
    let p = resolve(root, rel)?;
    if p.exists() { return Err(VaultError::Exists(rel.into())); }
    write_note(root, rel, content).map(|_| ())
}

pub fn delete_note(root: &Path, rel: &str) -> Result<()> {
    let p = resolve(root, rel)?;
    if !p.is_file() { return Err(VaultError::NotFound(rel.into())); }
    Ok(std::fs::remove_file(p)?)
}

pub fn list_notes(root: &Path) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for e in walkdir::WalkDir::new(root).into_iter().filter_entry(|e| {
        !(e.file_type().is_dir() && e.depth() > 0 && {
            let n = e.file_name().to_string_lossy();
            is_hidden_dir(&n) || n.starts_with('.')
        })
    }) {
        let e = e.map_err(|e| VaultError::Io(e.into()))?;
        if e.file_type().is_file() && e.path().extension().map(|x| x == "md").unwrap_or(false) {
            out.push(to_rel(root, e.path()));
        }
    }
    out.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fx() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::create_dir_all(r.join("features/checkout/assets")).unwrap();
        fs::create_dir_all(r.join("daily")).unwrap();
        fs::create_dir_all(r.join(".git")).unwrap();
        fs::write(r.join("inbox.md"), "- [ ] a").unwrap();
        fs::write(r.join("features/checkout/feature.md"), "---\ntype: feature\ntitle: Checkout\n---\n# Checkout").unwrap();
        fs::write(r.join("features/checkout/PROJ-1.md"), "# t").unwrap();
        fs::write(r.join("features/checkout/assets/x.png"), b"png").unwrap();
        fs::write(r.join("daily/2026-10-14.md"), "x").unwrap();
        d
    }

    #[test]
    fn resolve_rejects_escape() {
        let d = fx();
        assert!(matches!(resolve(d.path(), "../x.md"), Err(VaultError::Escape(_))));
        assert!(matches!(resolve(d.path(), "features/../../x.md"), Err(VaultError::Escape(_))));
        assert!(matches!(resolve(d.path(), "C:/Windows/x.md"), Err(VaultError::Escape(_))));
        assert!(resolve(d.path(), "features/checkout/PROJ-1.md").is_ok());
        assert!(resolve(d.path(), "new/not-yet-there.md").is_ok());
    }

    #[test]
    fn list_tree_hides_internal_dirs_and_sorts_dirs_first() {
        let d = fx();
        let t = list_tree(d.path()).unwrap();
        let names: Vec<&str> = t.children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["daily", "features", "inbox.md"]);
        let checkout = &t.children[1].children[0];
        let kids: Vec<&str> = checkout.children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(kids, vec!["feature.md", "PROJ-1.md"]);
        assert_eq!(checkout.children[1].note_type.as_deref(), Some("ticket"));
        assert_eq!(checkout.children[1].rel, "features/checkout/PROJ-1.md");
    }

    #[test]
    fn read_note_parses_meta_and_type() {
        let d = fx();
        let n = read_note(d.path(), "features/checkout/feature.md").unwrap();
        assert_eq!(n.meta["title"], "Checkout");
        assert_eq!(n.note_type, "feature");
        assert!(n.content.starts_with("---"));
        assert!(n.mtime_ms > 0);
        let n2 = read_note(d.path(), "features/checkout/PROJ-1.md").unwrap();
        assert_eq!(n2.note_type, "ticket");
    }

    #[test]
    fn write_creates_parents_and_create_refuses_overwrite() {
        let d = fx();
        write_note(d.path(), "features/new/PROJ-9.md", "hi").unwrap();
        assert_eq!(fs::read_to_string(d.path().join("features/new/PROJ-9.md")).unwrap(), "hi");
        assert!(matches!(create_note(d.path(), "inbox.md", "x"), Err(VaultError::Exists(_))));
        create_note(d.path(), "ai/prompts/p.md", "p").unwrap();
        assert!(d.path().join("ai/prompts/p.md").exists());
    }

    #[test]
    fn delete_and_list_notes() {
        let d = fx();
        delete_note(d.path(), "daily/2026-10-14.md").unwrap();
        assert!(!d.path().join("daily/2026-10-14.md").exists());
        let all = list_notes(d.path()).unwrap();
        assert_eq!(all, vec!["features/checkout/PROJ-1.md", "features/checkout/feature.md", "inbox.md"]);
        assert!(matches!(read_note(d.path(), "nope.md"), Err(VaultError::NotFound(_))));
    }
}
