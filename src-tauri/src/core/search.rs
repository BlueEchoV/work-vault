use crate::core::vault::{self, resolve, Result};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct Hit { pub note: String, pub line: usize, pub col: usize, pub text: String }

pub fn search(root: &Path, query: &str, limit: usize) -> Result<Vec<Hit>> {
    let q = query.trim().to_lowercase();
    let mut out = Vec::new();
    if q.is_empty() { return Ok(out); }
    'outer: for note in vault::list_notes(root)? {
        let text = std::fs::read_to_string(resolve(root, &note)?)?;
        for (i, line) in text.lines().enumerate() {
            let lower = line.to_lowercase();
            if let Some(col) = lower.find(&q) {
                out.push(Hit { note: note.clone(), line: i, col, text: line.trim_end_matches('\r').to_string() });
                if out.len() >= limit { break 'outer; }
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn case_insensitive_hits_with_line_and_col() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.md"), "Hello\nfigma LINK here\n").unwrap();
        std::fs::write(d.path().join("b.md"), "no match").unwrap();
        let h = search(d.path(), "link", 50).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!((h[0].note.as_str(), h[0].line, h[0].col), ("a.md", 1, 6));
        assert_eq!(h[0].text, "figma LINK here");
        assert!(search(d.path(), "  ", 50).unwrap().is_empty());
        assert_eq!(search(d.path(), "o", 1).unwrap().len(), 1, "limit respected");
    }
}
