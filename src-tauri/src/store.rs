//! Tickets, epics and note pages are Markdown files: `<data>/tickets/<id>.md`, `<data>/epics/<id>.md`, `<data>/notes/<id>.md`.
//! This module only moves text in and out of those files; the app parses it.
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, PartialEq)]
pub struct Item { pub kind: String, pub id: String, pub text: String }

const KINDS: [&str; 3] = ["ticket", "epic", "note"];

fn folder(kind: &str) -> &'static str {
    match kind { "epic" => "epics", "note" => "notes", _ => "tickets" }
}

/// The file for one item, refusing kinds and ids that could point outside the data folder.
pub fn file(root: &Path, kind: &str, id: &str) -> Result<PathBuf, String> {
    if !KINDS.contains(&kind) { return Err(format!("unknown kind {kind}")); }
    let ok = !id.is_empty() && id.len() <= 100 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok { return Err(format!("bad id {id}")); }
    Ok(root.join(folder(kind)).join(format!("{id}.md")))
}

pub fn list(root: &Path) -> Result<Vec<Item>, String> {
    let mut out = Vec::new();
    for kind in KINDS {
        let dir = root.join(folder(kind));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("md") { continue; }
            let Some(id) = p.file_stem().and_then(|s| s.to_str()) else { continue };
            if let Ok(text) = std::fs::read_to_string(&p) {
                out.push(Item { kind: kind.to_string(), id: id.to_string(), text });
            }
        }
    }
    Ok(out)
}

/// Writes through a temp file and a rename, so a crash never leaves half a note.
pub fn save(root: &Path, kind: &str, id: &str, text: &str) -> Result<(), String> {
    let p = file(root, kind, id)?;
    std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("md.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

const IMAGE_EXTS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

fn valid_name(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The full path of an image link from a note: `assets/<id>/<name>.<ext>` (or the older `assets/<name>.<ext>`),
/// refusing anything that could leave the assets folder or is not an image.
pub fn image_file(root: &Path, kind: &str, rel: &str) -> Result<PathBuf, String> {
    if !KINDS.contains(&kind) { return Err(format!("unknown kind {kind}")); }
    let rest = rel.strip_prefix("assets/").ok_or("not an assets link")?;
    let parts: Vec<&str> = rest.split('/').collect();
    if parts.len() > 2 { return Err(format!("bad image link {rel}")); }
    let (stem, ext) = parts[parts.len() - 1].rsplit_once('.').ok_or("image has no extension")?;
    if !IMAGE_EXTS.contains(&ext.to_ascii_lowercase().as_str()) { return Err(format!("not an image type: {ext}")); }
    if !valid_name(stem) || !parts[..parts.len() - 1].iter().all(|p| valid_name(p)) { return Err(format!("bad image link {rel}")); }
    let mut p = root.join(folder(kind)).join("assets");
    for part in parts { p.push(part); }
    Ok(p)
}

/// `<dir>/<stem>.<ext>`, or `<stem>_1`, `<stem>_2`… when that name is taken, so images can share a name.
fn free_rel(root: &Path, kind: &str, dir: &str, stem: &str, ext: &str) -> Result<String, String> {
    let mut rel = format!("{dir}/{stem}.{ext}");
    let mut n = 1;
    while image_file(root, kind, &rel)?.exists() { rel = format!("{dir}/{stem}_{n}.{ext}"); n += 1; }
    Ok(rel)
}

/// Saves a pasted image in `<data>/<kind>s/assets/<id>/<name>`. Returns the link for the notes, relative to the note file.
pub fn save_image(root: &Path, kind: &str, id: &str, name: &str, bytes: &[u8]) -> Result<String, String> {
    file(root, kind, id)?;
    let (stem, ext) = name.rsplit_once('.').ok_or("image name has no extension")?;
    let rel = free_rel(root, kind, &format!("assets/{id}"), stem, &ext.to_ascii_lowercase())?;
    let p = image_file(root, kind, &rel)?;
    std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
    Ok(rel)
}

/// Renames an image file in place (same folder, same extension) and returns its new link.
pub fn rename_image(root: &Path, kind: &str, rel: &str, stem: &str) -> Result<String, String> {
    let from = image_file(root, kind, rel)?;
    if !from.is_file() { return Err(format!("{rel} is missing")); }
    let (dir, file_name) = rel.rsplit_once('/').unwrap();
    let (old_stem, ext) = file_name.rsplit_once('.').unwrap();
    if old_stem == stem { return Ok(rel.to_string()); }
    let to_rel = free_rel(root, kind, dir, stem, ext)?;
    std::fs::rename(&from, image_file(root, kind, &to_rel)?).map_err(|e| e.to_string())?;
    Ok(to_rel)
}

pub fn read_image(root: &Path, kind: &str, rel: &str) -> Result<Vec<u8>, String> {
    std::fs::read(image_file(root, kind, rel)?).map_err(|e| e.to_string())
}

fn stamp() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

/// Moves an image the notes no longer use into `<data>/trash/`.
pub fn trash_image(root: &Path, kind: &str, rel: &str) -> Result<(), String> {
    let p = image_file(root, kind, rel)?;
    if !p.exists() { return Ok(()); }
    let trash = root.join("trash");
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let name = rel.trim_start_matches("assets/").replace('/', "-");
    std::fs::rename(&p, trash.join(format!("{}-{name}", stamp()))).map_err(|e| e.to_string())
}

/// Deleting moves the file into `<data>/trash/` instead of destroying it.
pub fn remove(root: &Path, kind: &str, id: &str) -> Result<(), String> {
    let p = file(root, kind, id)?;
    if !p.exists() { return Ok(()); }
    let trash = root.join("trash");
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    std::fs::rename(&p, trash.join(format!("{kind}-{id}-{}.md", stamp()))).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_list_and_overwrite() {
        let d = tempfile::tempdir().unwrap();
        save(d.path(), "ticket", "fix-login", "one").unwrap();
        save(d.path(), "epic", "checkout", "epic text").unwrap();
        save(d.path(), "ticket", "fix-login", "two").unwrap();
        let mut items = list(d.path()).unwrap();
        items.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(items, vec![
            Item { kind: "epic".into(), id: "checkout".into(), text: "epic text".into() },
            Item { kind: "ticket".into(), id: "fix-login".into(), text: "two".into() },
        ]);
        assert!(d.path().join("tickets/fix-login.md").is_file());
        assert!(!d.path().join("tickets/fix-login.md.tmp").exists());
    }

    #[test]
    fn list_skips_other_files_and_creates_folders() {
        let d = tempfile::tempdir().unwrap();
        assert!(list(d.path()).unwrap().is_empty());
        std::fs::write(d.path().join("tickets/notes.txt"), "x").unwrap();
        assert!(list(d.path()).unwrap().is_empty());
        assert!(d.path().join("notes").is_dir());
    }

    #[test]
    fn note_pages_live_in_their_own_folder() {
        let d = tempfile::tempdir().unwrap();
        save(d.path(), "note", "setup", "# Setup").unwrap();
        assert!(d.path().join("notes/setup.md").is_file());
        assert_eq!(list(d.path()).unwrap(), vec![Item { kind: "note".into(), id: "setup".into(), text: "# Setup".into() }]);
    }

    #[test]
    fn remove_moves_to_trash() {
        let d = tempfile::tempdir().unwrap();
        save(d.path(), "ticket", "a", "keep me").unwrap();
        remove(d.path(), "ticket", "a").unwrap();
        assert!(list(d.path()).unwrap().is_empty());
        let trashed: Vec<_> = std::fs::read_dir(d.path().join("trash")).unwrap().flatten().collect();
        assert_eq!(trashed.len(), 1);
        assert_eq!(std::fs::read_to_string(trashed[0].path()).unwrap(), "keep me");
        remove(d.path(), "ticket", "a").unwrap();
    }

    #[test]
    fn images_save_rename_read_and_trash() {
        let d = tempfile::tempdir().unwrap();
        let rel = save_image(d.path(), "ticket", "pay", "pasted-1.PNG", b"one").unwrap();
        assert_eq!(rel, "assets/pay/pasted-1.png");
        assert_eq!(save_image(d.path(), "ticket", "pay", "pasted-1.png", b"two").unwrap(), "assets/pay/pasted-1_1.png");
        assert!(d.path().join("tickets/assets/pay/pasted-1.png").is_file());

        let renamed = rename_image(d.path(), "ticket", &rel, "login-error").unwrap();
        assert_eq!(renamed, "assets/pay/login-error.png");
        assert_eq!(read_image(d.path(), "ticket", &renamed).unwrap(), b"one");
        assert!(!d.path().join("tickets/assets/pay/pasted-1.png").exists());
        assert_eq!(rename_image(d.path(), "ticket", "assets/pay/pasted-1_1.png", "login-error").unwrap(), "assets/pay/login-error_1.png");
        assert_eq!(rename_image(d.path(), "ticket", &renamed, "login-error").unwrap(), renamed);

        trash_image(d.path(), "ticket", &renamed).unwrap();
        assert!(read_image(d.path(), "ticket", &renamed).is_err());
        assert_eq!(std::fs::read_dir(d.path().join("trash")).unwrap().count(), 1);
    }

    #[test]
    fn image_links_stay_inside_assets() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(image_file(d.path(), "epic", "assets/e/a.jpg").unwrap(), d.path().join("epics").join("assets").join("e").join("a.jpg"));
        assert!(image_file(d.path(), "ticket", "assets/old-style.png").is_ok());
        for bad in ["assets/../x.png", "assets/a/../../x.png", "assets/a/b/c.png", "other/a.png", "assets/a/x.exe", "assets/a/x"] {
            assert!(image_file(d.path(), "ticket", bad).is_err(), "{bad}");
        }
        assert!(save_image(d.path(), "ticket", "../x", "a.png", b"x").is_err());
        assert!(rename_image(d.path(), "ticket", "assets/a/missing.png", "b").is_err());
    }

    #[test]
    fn refuses_paths_outside_the_folder() {
        let d = tempfile::tempdir().unwrap();
        assert!(file(d.path(), "ticket", "../x").is_err());
        assert!(file(d.path(), "ticket", "a/b").is_err());
        assert!(file(d.path(), "ticket", "").is_err());
        assert!(file(d.path(), "other", "a").is_err());
    }
}
