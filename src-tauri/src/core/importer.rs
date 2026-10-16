use crate::core::vault::{resolve, Result};
use std::path::Path;

fn unique(dir: &Path, stem: &str, ext: &str) -> String {
    let first = format!("{stem}.{ext}");
    if !dir.join(&first).exists() { return first; }
    let mut n = 1;
    loop { let c = format!("{stem}-{n}.{ext}"); if !dir.join(&c).exists() { return c; } n += 1; }
}

pub fn import_text(root: &Path, src: &Path, dest_dir_rel: &str) -> Result<String> {
    let dest_dir = if dest_dir_rel.is_empty() { root.to_path_buf() } else { resolve(root, dest_dir_rel)? };
    std::fs::create_dir_all(&dest_dir)?;
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "imported".into());
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let name = unique(&dest_dir, &stem, "md");
    let content = std::fs::read_to_string(src)?;
    std::fs::write(dest_dir.join(&name), content)?;
    if ext != "md" {
        let raw = dest_dir.join("raw");
        std::fs::create_dir_all(&raw)?;
        let raw_name = unique(&raw, &stem, if ext.is_empty() { "txt" } else { &ext });
        std::fs::copy(src, raw.join(raw_name))?;
    }
    let rel = if dest_dir_rel.is_empty() { name } else { format!("{}/{}", dest_dir_rel.trim_end_matches('/'), name) };
    Ok(rel)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn txt_becomes_md_and_original_kept_in_raw() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("outside.txt");
        std::fs::write(&src, "notes").unwrap();
        std::fs::create_dir_all(d.path().join("features/x")).unwrap();
        let rel = import_text(d.path(), &src, "features/x").unwrap();
        assert_eq!(rel, "features/x/outside.md");
        assert_eq!(std::fs::read_to_string(d.path().join(&rel)).unwrap(), "notes");
        assert!(d.path().join("features/x/raw/outside.txt").exists());
        let rel2 = import_text(d.path(), &src, "features/x").unwrap();
        assert_eq!(rel2, "features/x/outside-1.md");
    }
    #[test]
    fn md_is_copied_without_raw() {
        let d = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let src = outside.path().join("n.md");
        std::fs::write(&src, "# n").unwrap();
        let rel = import_text(d.path(), &src, "").unwrap();
        assert_eq!(rel, "n.md");
        assert!(!d.path().join("raw").exists());
    }
}
