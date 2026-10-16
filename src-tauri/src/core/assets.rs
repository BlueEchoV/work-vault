use crate::core::links;
use crate::core::vault::{self, resolve, to_rel, Result, VaultError};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
pub const VIDEO_EXT: &[&str] = &["mp4", "webm", "mov", "mkv", "m4v"];
pub fn is_image(ext: &str) -> bool { IMAGE_EXT.contains(&ext.to_lowercase().as_str()) }
pub fn is_video(ext: &str) -> bool { VIDEO_EXT.contains(&ext.to_lowercase().as_str()) }
pub fn is_media(ext: &str) -> bool { is_image(ext) || is_video(ext) }

pub fn assets_dir_rel(note_rel: &str) -> String {
    match note_rel.rsplit_once('/') { Some((dir, _)) => format!("{dir}/assets"), None => "assets".into() }
}

fn note_stem(note_rel: &str) -> &str {
    let name = note_rel.rsplit('/').next().unwrap_or(note_rel);
    name.strip_suffix(".md").unwrap_or(name)
}

pub fn new_asset_name(note_rel: &str, ext: &str, now: chrono::NaiveDateTime, exists: &dyn Fn(&str) -> bool) -> String {
    let base = format!("{}_{}", note_stem(note_rel), now.format("%Y%m%d-%H%M%S"));
    let ext = ext.trim_start_matches('.').to_lowercase();
    let first = format!("{base}.{ext}");
    if !exists(&first) { return first; }
    let mut n = 1;
    loop {
        let cand = format!("{base}-{n}.{ext}");
        if !exists(&cand) { return cand; }
        n += 1;
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetRef { pub rel: String, pub link: String }

fn allocate(root: &Path, note_rel: &str, ext: &str) -> Result<(PathBuf, AssetRef)> {
    let dir_rel = assets_dir_rel(note_rel);
    let dir = resolve(root, &dir_rel)?;
    std::fs::create_dir_all(&dir)?;
    let name = new_asset_name(note_rel, ext, chrono::Local::now().naive_local(), &|n| dir.join(n).exists());
    let path = dir.join(&name);
    Ok((path, AssetRef { rel: format!("{dir_rel}/{name}"), link: format!("assets/{name}") }))
}

pub fn save_bytes(root: &Path, note_rel: &str, ext: &str, bytes: &[u8]) -> Result<AssetRef> {
    let (path, r) = allocate(root, note_rel, ext)?;
    std::fs::write(path, bytes)?;
    Ok(r)
}

pub fn import_file(root: &Path, note_rel: &str, src: &Path) -> Result<AssetRef> {
    let ext = src.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_else(|| "bin".into());
    let (path, r) = allocate(root, note_rel, &ext)?;
    std::fs::copy(src, path)?;
    Ok(r)
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetInfo { pub rel: String, pub name: String, pub kind: String, pub size: u64, pub referenced_by: Vec<String> }

/// Map of asset rel path -> notes (rel) that link to it.
pub fn references(root: &Path) -> Result<HashMap<String, Vec<String>>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for note in vault::list_notes(root)? {
        let abs = resolve(root, &note)?;
        let text = std::fs::read_to_string(&abs)?;
        let dir = abs.parent().unwrap_or(root).to_path_buf();
        for l in links::find_relative_links(&text) {
            let target = links::normalize(&dir.join(&l.target));
            let rel = to_rel(root, &target);
            let v = map.entry(rel).or_default();
            if !v.contains(&note) { v.push(note.clone()); }
        }
    }
    Ok(map)
}

pub fn list_for_note(root: &Path, note_rel: &str) -> Result<Vec<AssetInfo>> {
    let abs = resolve(root, note_rel)?;
    let text = if abs.is_file() { std::fs::read_to_string(&abs)? } else { String::new() };
    let dir = abs.parent().unwrap_or(root).to_path_buf();
    let refs = references(root)?;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for l in links::find_relative_links(&text) {
        let target = links::normalize(&dir.join(&l.target));
        let rel = to_rel(root, &target);
        if !seen.insert(rel.clone()) || !target.is_file() { continue; }
        let ext = target.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !is_media(&ext) { continue; }
        let kind = if is_image(&ext) { "image" } else { "video" };
        let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
        let name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        out.push(AssetInfo { referenced_by: refs.get(&rel).cloned().unwrap_or_default(), rel, name, kind: kind.into(), size });
    }
    Ok(out)
}

/// Move (or rename) an asset and rewrite every note that links to it. Returns rewritten note rels.
pub fn move_asset(root: &Path, from_rel: &str, to_rel_: &str) -> Result<Vec<String>> {
    let from = resolve(root, from_rel)?;
    let to = resolve(root, to_rel_)?;
    if !from.is_file() { return Err(VaultError::NotFound(from_rel.into())); }
    if to.exists() { return Err(VaultError::Exists(to_rel_.into())); }
    if let Some(p) = to.parent() { std::fs::create_dir_all(p)?; }
    let from_norm = links::normalize(&from);
    let mut rewritten = Vec::new();
    for note in vault::list_notes(root)? {
        let abs = resolve(root, &note)?;
        let text = std::fs::read_to_string(&abs)?;
        let dir = abs.parent().unwrap_or(root).to_path_buf();
        let mut changed = false;
        let new_text = links::rewrite_links(&text, &mut |t| {
            if links::normalize(&dir.join(t)) == from_norm { changed = true; Some(links::relative_path(&dir, &to)) } else { None }
        });
        if changed { std::fs::write(&abs, new_text)?; rewritten.push(note); }
    }
    std::fs::rename(&from, &to)?;
    Ok(rewritten)
}

pub fn delete_asset(root: &Path, rel: &str) -> Result<()> {
    let abs = resolve(root, rel)?;
    if !abs.is_file() { return Err(VaultError::NotFound(rel.into())); }
    let refs = references(root)?;
    if let Some(notes) = refs.get(&to_rel(root, &links::normalize(&abs))) {
        if !notes.is_empty() { return Err(VaultError::Referenced(notes.clone())); }
    }
    Ok(std::fs::remove_file(abs)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fx() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::create_dir_all(r.join("features/a/assets")).unwrap();
        fs::create_dir_all(r.join("features/b")).unwrap();
        fs::write(r.join("features/a/assets/PROJ-1_20261015-120000.png"), b"1").unwrap();
        fs::write(r.join("features/a/assets/shared.png"), b"2").unwrap();
        fs::write(r.join("features/a/PROJ-1.md"), "![](assets/PROJ-1_20261015-120000.png)\n![](assets/shared.png)\n").unwrap();
        fs::write(r.join("features/a/PROJ-2.md"), "see ![](assets/shared.png)\n").unwrap();
        d
    }

    #[test]
    fn asset_name_collision_gets_suffix() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 10, 15).unwrap().and_hms_opt(20, 30, 11).unwrap();
        let taken = |n: &str| n == "PROJ-1_20261015-203011.png" || n == "PROJ-1_20261015-203011-1.png";
        assert_eq!(new_asset_name("features/a/PROJ-1.md", "png", now, &|_| false), "PROJ-1_20261015-203011.png");
        assert_eq!(new_asset_name("features/a/PROJ-1.md", "png", now, &taken), "PROJ-1_20261015-203011-2.png");
        assert_eq!(assets_dir_rel("features/a/PROJ-1.md"), "features/a/assets");
        assert_eq!(assets_dir_rel("inbox.md"), "assets");
    }

    #[test]
    fn save_bytes_writes_file_and_returns_note_relative_link() {
        let d = fx();
        let r = save_bytes(d.path(), "features/b/PROJ-3.md", "png", b"img").unwrap();
        assert!(r.rel.starts_with("features/b/assets/PROJ-3_"));
        assert!(r.link.starts_with("assets/PROJ-3_") && r.link.ends_with(".png"));
        assert_eq!(fs::read(d.path().join(&r.rel)).unwrap(), b"img");
    }

    #[test]
    fn import_file_copies_with_new_name() {
        let d = fx();
        let src = d.path().join("clip.mp4");
        fs::write(&src, b"vid").unwrap();
        let r = import_file(d.path(), "features/a/PROJ-1.md", &src).unwrap();
        assert!(r.rel.ends_with(".mp4"));
        assert!(d.path().join(&r.rel).exists());
        assert!(src.exists(), "import copies, never moves the source");
    }

    #[test]
    fn references_and_list_for_note() {
        let d = fx();
        let refs = references(d.path()).unwrap();
        assert_eq!(refs["features/a/assets/shared.png"].len(), 2);
        assert_eq!(refs["features/a/assets/PROJ-1_20261015-120000.png"], vec!["features/a/PROJ-1.md"]);
        let list = list_for_note(d.path(), "features/a/PROJ-1.md").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].kind, "image");
        assert!(list.iter().any(|a| a.name == "shared.png" && a.referenced_by.len() == 2));
    }

    #[test]
    fn move_asset_rewrites_every_referencing_note() {
        let d = fx();
        let rewritten = move_asset(d.path(), "features/a/assets/shared.png", "features/b/assets/shared.png").unwrap();
        assert_eq!(rewritten.len(), 2);
        assert!(d.path().join("features/b/assets/shared.png").exists());
        let t = fs::read_to_string(d.path().join("features/a/PROJ-2.md")).unwrap();
        assert_eq!(t, "see ![](../b/assets/shared.png)\n");
    }

    #[test]
    fn delete_refuses_when_referenced() {
        let d = fx();
        assert!(matches!(delete_asset(d.path(), "features/a/assets/shared.png"), Err(crate::core::vault::VaultError::Referenced(_))));
        fs::write(d.path().join("features/a/assets/orphan.png"), b"o").unwrap();
        delete_asset(d.path(), "features/a/assets/orphan.png").unwrap();
        assert!(!d.path().join("features/a/assets/orphan.png").exists());
    }

    #[test]
    fn move_note_keeps_shared_asset_and_rewrites_link() {
        let d = fx();
        let moved = crate::core::vault::move_note(d.path(), "features/a/PROJ-1.md", "features/b/PROJ-1.md").unwrap();
        assert_eq!(moved, vec!["features/b/assets/PROJ-1_20261015-120000.png"]);
        assert!(!d.path().join("features/a/PROJ-1.md").exists());
        assert!(d.path().join("features/b/assets/PROJ-1_20261015-120000.png").exists());
        assert!(d.path().join("features/a/assets/shared.png").exists(), "shared asset stays");
        let t = fs::read_to_string(d.path().join("features/b/PROJ-1.md")).unwrap();
        assert_eq!(t, "![](assets/PROJ-1_20261015-120000.png)\n![](../a/assets/shared.png)\n");
    }
}
