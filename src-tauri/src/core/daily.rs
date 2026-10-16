use crate::core::todos;
use crate::core::vault::{resolve, Result};
use chrono::NaiveDate;
use serde::Serialize;
use std::path::Path;

pub fn rel_for(date: NaiveDate) -> String { format!("daily/{}.md", date.format("%Y-%m-%d")) }

#[derive(Debug, Clone, Serialize)]
pub struct EnsureReport { pub rel: String, pub created: bool, pub carried: usize }

fn previous_daily(root: &Path, today: NaiveDate) -> Option<(NaiveDate, String)> {
    let dir = root.join("daily");
    let mut best: Option<(NaiveDate, String)> = None;
    for e in std::fs::read_dir(dir).ok()? {
        let name = e.ok()?.file_name().to_string_lossy().to_string();
        let Some(stem) = name.strip_suffix(".md") else { continue };
        if let Ok(d) = NaiveDate::parse_from_str(stem, "%Y-%m-%d") {
            if d < today && best.as_ref().map(|b| d > b.0).unwrap_or(true) { best = Some((d, format!("daily/{name}"))); }
        }
    }
    best
}

pub fn ensure(root: &Path, today: NaiveDate) -> Result<EnsureReport> {
    let rel = rel_for(today);
    let path = resolve(root, &rel)?;
    if path.exists() { return Ok(EnsureReport { rel, created: false, carried: 0 }); }
    std::fs::create_dir_all(path.parent().unwrap())?;
    let mut carried: Vec<String> = Vec::new();
    if let Some((_, prev_rel)) = previous_daily(root, today) {
        let text = std::fs::read_to_string(resolve(root, &prev_rel)?)?;
        let open: Vec<_> = todos::scan_text(&prev_rel, &text).into_iter().filter(|t| t.state == "open").collect();
        for t in &open { todos::set_state(root, &prev_rel, t.line, "forwarded")?; }
        carried = open.into_iter().map(|t| t.text).collect();
    }
    let date = today.format("%Y-%m-%d");
    let mut body = format!("---\ntype: daily\ndate: {date}\n---\n# {date}\n\n## Todo\n");
    for c in &carried { body.push_str(&format!("- [ ] {c}\n")); }
    if carried.is_empty() { body.push_str("- [ ] \n"); }
    body.push_str("\n## Notes\n\n");
    std::fs::write(&path, body)?;
    Ok(EnsureReport { rel, created: true, carried: carried.len() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn creates_today_with_carry_over_and_forwards_old() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("daily")).unwrap();
        std::fs::write(d.path().join("daily/2026-10-13.md"), "## Todo\n- [ ] old\n- [x] done\n").unwrap();
        std::fs::write(d.path().join("daily/2026-10-10.md"), "- [ ] older\n").unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
        let r = ensure(d.path(), today).unwrap();
        assert_eq!(r.rel, "daily/2026-10-15.md");
        assert!(r.created);
        assert_eq!(r.carried, 1);
        let t = std::fs::read_to_string(d.path().join("daily/2026-10-15.md")).unwrap();
        assert!(t.starts_with("---\ntype: daily\ndate: 2026-10-15\n---\n# 2026-10-15\n\n## Todo\n- [ ] old\n"));
        assert!(t.contains("\n## Notes\n"));
        let old = std::fs::read_to_string(d.path().join("daily/2026-10-13.md")).unwrap();
        assert_eq!(old, "## Todo\n- [>] old\n- [x] done\n");
        let r2 = ensure(d.path(), today).unwrap();
        assert!(!r2.created);
    }

    #[test]
    fn first_ever_daily_has_no_carry_over() {
        let d = tempfile::tempdir().unwrap();
        let r = ensure(d.path(), NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()).unwrap();
        assert!(r.created);
        assert_eq!(r.carried, 0);
        assert!(d.path().join("daily/2026-01-01.md").exists());
    }
}
