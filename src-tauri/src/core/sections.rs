//! A "section" is a run of Markdown text, usually one `## ` capture entry. Captures are appended to
//! inboxes, tickets and demos, and moved between them as text, so a moved section keeps working:
//! its relative links are rewritten for the new folder and the screenshots only it uses move with it.
use crate::core::assets::{self, assets_dir_rel};
use crate::core::links;
use crate::core::vault::{resolve, to_rel, Result, VaultError};
use std::path::Path;

/// Appends `text` to the note at `rel` after one blank line. A missing note is created from `initial` first.
pub fn append(root: &Path, rel: &str, text: &str, initial: Option<&str>) -> Result<()> {
    let p = resolve(root, rel)?;
    let existing = if p.is_file() { std::fs::read_to_string(&p)? } else { initial.unwrap_or("").to_string() };
    if let Some(parent) = p.parent() { std::fs::create_dir_all(parent)?; }
    std::fs::write(&p, joined(&existing, text))?;
    Ok(())
}

fn joined(existing: &str, text: &str) -> String {
    let body = existing.trim_end_matches(['\n', '\r', ' ']);
    let sep = if body.is_empty() { "" } else { "\n\n" };
    format!("{body}{sep}{}\n", text.trim_matches(['\n', '\r']))
}

/// Removes the first occurrence of `text` from `src`, closing the gap it leaves. None if absent.
fn cut(src: &str, text: &str) -> Option<String> {
    let needle = text.trim_matches(['\n', '\r']);
    if needle.is_empty() { return None; }
    let at = src.find(needle)?;
    let (before, after) = (&src[..at], &src[at + needle.len()..]);
    let before = before.trim_end_matches(['\n', '\r', ' ']);
    let after = after.trim_start_matches(['\n', '\r']);
    Some(match (before.is_empty(), after.is_empty()) {
        (true, _) => after.to_string(),
        (false, true) => format!("{before}\n"),
        (false, false) => format!("{before}\n\n{after}"),
    })
}

/// Deletes one section from a note (it stays in git history).
pub fn remove(root: &Path, rel: &str, text: &str) -> Result<()> {
    let p = resolve(root, rel)?;
    let src = std::fs::read_to_string(&p)?;
    let rest = cut(&src, text).ok_or_else(|| changed(rel))?;
    std::fs::write(&p, rest)?;
    Ok(())
}

fn changed(rel: &str) -> VaultError { VaultError::Invalid(format!("that item is no longer in {rel}; it may have been edited or moved already")) }

/// Moves one section from note `from` to note `to` (created from `initial` when missing).
/// Assets in `from`'s assets folder that nothing else links to move to `to`'s assets folder.
/// Writes the target before the source, so a failure can duplicate an item but never lose it.
/// Returns the asset rels that moved.
pub fn move_section(root: &Path, from: &str, text: &str, to: &str, initial: Option<&str>) -> Result<Vec<String>> {
    if from == to { return Ok(vec![]); }
    let from_abs = resolve(root, from)?;
    let to_abs = resolve(root, to)?;
    let src = std::fs::read_to_string(&from_abs)?;
    let rest = cut(&src, text).ok_or_else(|| changed(from))?;
    let from_dir = from_abs.parent().unwrap_or(root).to_path_buf();
    let to_dir = to_abs.parent().unwrap_or(root).to_path_buf();
    let old_assets = links::normalize(&root.join(assets_dir_rel(&to_rel(root, &from_abs))));
    let new_assets_rel = assets_dir_rel(&to_rel(root, &to_abs));
    let refs = assets::references(root)?;
    let still_in_source: Vec<String> = links::find_relative_links(&rest).iter()
        .map(|l| to_rel(root, &links::normalize(&from_dir.join(&l.target)))).collect();
    let mut moved = Vec::new();
    let new_text = links::rewrite_links(text, &mut |t| {
        let abs = links::normalize(&from_dir.join(t));
        let rel = to_rel(root, &abs);
        let only_here = refs.get(&rel).map(|n| n.iter().all(|x| x == from)).unwrap_or(true) && !still_in_source.contains(&rel);
        let name = abs.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let dest = root.join(&new_assets_rel).join(&name);
        if only_here && abs.starts_with(&old_assets) && abs.is_file() && old_assets != links::normalize(&root.join(&new_assets_rel)) && !dest.exists() {
            if std::fs::create_dir_all(root.join(&new_assets_rel)).and_then(|_| std::fs::rename(&abs, &dest)).is_ok() {
                moved.push(format!("{new_assets_rel}/{name}"));
                return Some(links::relative_path(&to_dir, &dest));
            }
        }
        Some(links::relative_path(&to_dir, &abs))
    });
    append(root, to, &new_text, initial)?;
    std::fs::write(&from_abs, rest)?;
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn append_separates_with_one_blank_line_and_creates_missing_notes() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("inbox.md"), "# Inbox\n\n\n").unwrap();
        append(d.path(), "inbox.md", "## a\nx\n", None).unwrap();
        append(d.path(), "inbox.md", "## b\ny", None).unwrap();
        assert_eq!(fs::read_to_string(d.path().join("inbox.md")).unwrap(), "# Inbox\n\n## a\nx\n\n## b\ny\n");
        append(d.path(), "features/c/inbox.md", "## c", Some("# Inbox — C\n")).unwrap();
        assert_eq!(fs::read_to_string(d.path().join("features/c/inbox.md")).unwrap(), "# Inbox — C\n\n## c\n");
    }

    #[test]
    fn cut_closes_the_gap() {
        assert_eq!(cut("# I\n\n## a\nx\n\n## b\ny\n", "## a\nx").unwrap(), "# I\n\n## b\ny\n");
        assert_eq!(cut("# I\n\n## a\nx\n", "## a\nx\n").unwrap(), "# I\n");
        assert_eq!(cut("## a\nx\n\n## b\n", "## a\nx").unwrap(), "## b\n");
        assert!(cut("abc", "zzz").is_none());
    }

    #[test]
    fn move_rewrites_links_and_carries_exclusive_assets() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::create_dir_all(r.join("assets")).unwrap();
        fs::create_dir_all(r.join("features/c")).unwrap();
        fs::write(r.join("assets/shot.png"), b"1").unwrap();
        fs::write(r.join("assets/shared.png"), b"2").unwrap();
        fs::write(r.join("links.md"), "![](assets/shared.png)\n").unwrap();
        fs::write(r.join("inbox.md"), "# Inbox\n\n## one\n![](assets/shot.png)\n![](assets/shared.png)\n[n](links.md)\n\n## two\nkeep\n").unwrap();
        fs::write(r.join("features/c/PROJ-1.md"), "# PROJ-1\n").unwrap();
        let section = "## one\n![](assets/shot.png)\n![](assets/shared.png)\n[n](links.md)\n";
        let moved = move_section(r, "inbox.md", section, "features/c/PROJ-1.md", None).unwrap();
        assert_eq!(moved, vec!["features/c/assets/shot.png"]);
        assert!(r.join("features/c/assets/shot.png").is_file());
        assert!(r.join("assets/shared.png").is_file(), "an asset another note uses stays put");
        assert_eq!(fs::read_to_string(r.join("features/c/PROJ-1.md")).unwrap(), "# PROJ-1\n\n## one\n![](assets/shot.png)\n![](../../assets/shared.png)\n[n](../../links.md)\n");
        assert_eq!(fs::read_to_string(r.join("inbox.md")).unwrap(), "# Inbox\n\n## two\nkeep\n");
    }

    #[test]
    fn move_refuses_an_item_that_is_gone_and_remove_deletes_one() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("inbox.md"), "## a\nx\n\n## b\ny\n").unwrap();
        assert!(move_section(d.path(), "inbox.md", "## zzz", "other.md", None).is_err());
        assert!(!d.path().join("other.md").exists());
        remove(d.path(), "inbox.md", "## a\nx").unwrap();
        assert_eq!(fs::read_to_string(d.path().join("inbox.md")).unwrap(), "## b\ny\n");
    }
}
