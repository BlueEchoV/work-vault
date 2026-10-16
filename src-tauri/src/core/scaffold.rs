use crate::core::vault::{Result, VaultError};
use std::path::Path;

const CLAUDE_MD: &str = include_str!("../../templates/CLAUDE.md");
const CMD_ORGANIZE: &str = include_str!("../../templates/commands/organize.md");
const CMD_HANDOFF: &str = include_str!("../../templates/commands/handoff.md");
const CMD_SUMMARIZE: &str = include_str!("../../templates/commands/summarize.md");
const CMD_BLOCKERS: &str = include_str!("../../templates/commands/blockers.md");

fn write_if_missing(p: &Path, content: &str) -> std::io::Result<()> {
    if p.exists() { return Ok(()); }
    if let Some(parent) = p.parent() { std::fs::create_dir_all(parent)?; }
    std::fs::write(p, content)
}

/// A folder counts as a vault once the skeleton is there.
pub fn is_vault(root: &Path) -> bool { root.join("inbox.md").is_file() || root.join("daily").is_dir() }

/// Files Windows drops into folders on its own; they do not make a folder "in use".
const NOISE: &[&str] = &["desktop.ini", "Thumbs.db", ".DS_Store"];

/// Create here is only allowed on a missing or empty folder, or on an existing vault.
/// Anything else (a Desktop, a Documents folder) would get a git repo and a commit of everything in it.
pub fn ensure_creatable(root: &Path) -> Result<()> {
    if !root.exists() || is_vault(root) { return Ok(()); }
    if !root.is_dir() { return Err(VaultError::Invalid(format!("{} is a file, not a folder", root.display()))); }
    let busy = std::fs::read_dir(root)?.filter_map(|e| e.ok()).any(|e| !NOISE.contains(&e.file_name().to_string_lossy().as_ref()));
    if busy { return Err(VaultError::Invalid(format!("{} is not empty. Pick a new or empty folder for the vault, or use Open existing on a folder that already is one.", root.display()))); }
    Ok(())
}

/// Open existing only accepts a folder that already holds a vault.
pub fn ensure_openable(root: &Path) -> Result<()> {
    if is_vault(root) { return Ok(()); }
    Err(VaultError::Invalid(format!("{} is not a vault (no inbox.md or daily folder). Use Create here on a new or empty folder.", root.display())))
}

/// Creates the vault skeleton. Idempotent: never overwrites existing files.
pub fn create_vault(root: &Path) -> Result<()> {
    for d in ["daily", "features", "ai/prompts", "ai/skills", "assets", ".claude/commands"] {
        std::fs::create_dir_all(root.join(d))?;
    }
    write_if_missing(&root.join("CLAUDE.md"), CLAUDE_MD)?;
    write_if_missing(&root.join("inbox.md"), "# Inbox\n\nDump anything here. Sort it later with `/organize`.\n\n")?;
    write_if_missing(&root.join("links.md"), "# Links\n\n- [Example](https://example.com) #example\n")?;
    write_if_missing(&root.join(".claude/commands/organize.md"), CMD_ORGANIZE)?;
    write_if_missing(&root.join(".claude/commands/handoff.md"), CMD_HANDOFF)?;
    write_if_missing(&root.join(".claude/commands/summarize.md"), CMD_SUMMARIZE)?;
    write_if_missing(&root.join(".claude/commands/blockers.md"), CMD_BLOCKERS)?;
    Ok(())
}

pub fn slugify(name: &str) -> String {
    let mut s: String = name.trim().to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    while s.contains("--") { s = s.replace("--", "-"); }
    s.trim_matches('-').to_string()
}

pub fn feature_template(name: &str, today: &str) -> String {
    format!("---\ntype: feature\ntitle: {name}\nstatus: active\njira_epic: \nfigma: []\ncreated: {today}\n---\n# {name}\n\n## Goal\n\n## Links\n\n## Questions\n\n## Blockers\n\n## Decisions\n\n## Notes\n\n")
}

pub fn ticket_template(key: &str, title: &str, today: &str) -> String {
    let t = if title.is_empty() { key } else { title };
    format!("---\ntype: ticket\njira: {key}\ntitle: {t}\nstatus: To Do\ncreated: {today}\n---\n# {key} — {t}\n\n## Summary\n\n## Acceptance criteria\n- [ ] \n\n## Notes\n\n## Questions\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ensure_creatable_accepts_missing_empty_and_existing_vault() {
        let d = tempfile::tempdir().unwrap();
        assert!(ensure_creatable(&d.path().join("new")).is_ok(), "missing folder");
        std::fs::write(d.path().join("desktop.ini"), "x").unwrap();
        assert!(ensure_creatable(d.path()).is_ok(), "folder with only desktop.ini");
        create_vault(d.path()).unwrap();
        assert!(ensure_creatable(d.path()).is_ok(), "existing vault");
    }
    #[test]
    fn ensure_creatable_refuses_a_folder_with_other_files() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("photo.png"), "x").unwrap();
        let err = ensure_creatable(d.path()).unwrap_err().to_string();
        assert!(err.contains("not empty"), "{err}");
    }
    #[test]
    fn ensure_openable_refuses_a_plain_folder_but_accepts_a_vault() {
        let d = tempfile::tempdir().unwrap();
        let err = ensure_openable(d.path()).unwrap_err().to_string();
        assert!(err.contains("not a vault"), "{err}");
        create_vault(d.path()).unwrap();
        assert!(ensure_openable(d.path()).is_ok());
    }
    #[test]
    fn scaffold_is_idempotent_and_slugs() {
        let d = tempfile::tempdir().unwrap();
        create_vault(d.path()).unwrap();
        std::fs::write(d.path().join("inbox.md"), "mine").unwrap();
        create_vault(d.path()).unwrap();
        assert_eq!(std::fs::read_to_string(d.path().join("inbox.md")).unwrap(), "mine");
        assert!(d.path().join(".claude/commands/handoff.md").exists());
        assert_eq!(slugify("  Checkout  Flow (v2) "), "checkout-flow-v2");
    }
}
