use crate::core::vault::{resolve, Result};
use std::path::Path;

fn unique(dir: &Path, stem: &str, ext: &str) -> String {
    let first = format!("{stem}.{ext}");
    if !dir.join(&first).exists() { return first; }
    let mut n = 1;
    loop { let c = format!("{stem}-{n}.{ext}"); if !dir.join(&c).exists() { return c; } n += 1; }
}

/// Characters 0x80..=0x9F of Windows-1252; the rest of the code page is Latin-1.
const CP1252_80_9F: [char; 32] = [
    '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž', '\u{8F}',
    '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9D}', 'ž', 'Ÿ',
];

fn utf16(rest: &[u8], unit: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = rest.chunks_exact(2).map(|c| unit([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units)
}

/// Decodes a text file the way Notepad++ would guess it: UTF-8 with or without a BOM,
/// UTF-16 with a BOM ("UCS-2 LE BOM"), otherwise Windows-1252 ("ANSI").
pub fn decode_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) { return String::from_utf8_lossy(rest).into_owned(); }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) { return utf16(rest, u16::from_le_bytes); }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) { return utf16(rest, u16::from_be_bytes); }
    if let Ok(s) = std::str::from_utf8(bytes) { return s.to_string(); }
    bytes.iter().map(|&b| if (0x80..=0x9F).contains(&b) { CP1252_80_9F[(b - 0x80) as usize] } else { b as char }).collect()
}

pub fn import_text(root: &Path, src: &Path, dest_dir_rel: &str) -> Result<String> {
    let dest_dir = if dest_dir_rel.is_empty() { root.to_path_buf() } else { resolve(root, dest_dir_rel)? };
    std::fs::create_dir_all(&dest_dir)?;
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "imported".into());
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let name = unique(&dest_dir, &stem, "md");
    let content = decode_text(&std::fs::read(src)?);
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
    #[test]
    fn txt_in_windows_1252_is_decoded() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("ansi.txt");
        std::fs::write(&src, b"caf\xE9 \x96 \x93quoted\x94").unwrap();
        let rel = import_text(d.path(), &src, "").unwrap();
        assert_eq!(std::fs::read_to_string(d.path().join(&rel)).unwrap(), "café – “quoted”");
    }
    #[test]
    fn txt_in_utf16le_with_bom_is_decoded() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("ucs2.txt");
        let mut bytes = vec![0xFF, 0xFE];
        for u in "héllo\r\nworld".encode_utf16() { bytes.extend_from_slice(&u.to_le_bytes()); }
        std::fs::write(&src, &bytes).unwrap();
        let rel = import_text(d.path(), &src, "").unwrap();
        assert_eq!(std::fs::read_to_string(d.path().join(&rel)).unwrap(), "héllo\r\nworld");
    }
    #[test]
    fn utf8_bom_is_stripped() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("bom.txt");
        std::fs::write(&src, "\u{FEFF}# title").unwrap();
        let rel = import_text(d.path(), &src, "").unwrap();
        assert_eq!(std::fs::read_to_string(d.path().join(&rel)).unwrap(), "# title");
    }
}
