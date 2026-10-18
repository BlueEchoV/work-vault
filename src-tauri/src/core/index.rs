use crate::core::assets::is_media;
use crate::core::vault::{self, resolve, to_rel, Result};
use crate::core::{frontmatter, links, todos};
use regex::Regex;
use serde::Serialize;
use std::path::Path;
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;

/// An http(s) link found in a note, with the line it sits on.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LinkRef { pub url: String, pub text: String, pub line: usize }

/// Everything the boards need to know about one note, without its body.
#[derive(Debug, Clone, Serialize)]
pub struct NoteInfo {
    pub rel: String,
    pub note_type: String,
    pub title: String,
    pub summary: String,
    pub meta: serde_json::Value,
    pub mtime_ms: u64,
    pub links: Vec<LinkRef>,
    /// Vault-relative paths of the images and videos the note embeds or links, existing files only.
    pub media: Vec<String>,
    /// Vault-relative paths of the other notes this one links to.
    pub refs: Vec<String>,
    /// Number of `## ` headings outside fenced code: capture entries in an inbox, segments in a demo.
    pub sections: usize,
    pub todos_open: usize,
    pub todos_done: usize,
    pub blockers: usize,
    pub questions: usize,
}

fn md_link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(!?)\[([^\]\n]*)\]\(<?(https?://[^\s)>]+)>?(?:\s+"[^"]*")?\)"#).unwrap())
}
fn bare_url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"https?://[^\s<>()\[\]"'`]+"#).unwrap())
}

/// http(s) links of a text: `[text](url)` links (not images) and bare or `<angle>` URLs, first occurrence of each URL.
/// Fenced code is skipped.
pub fn find_web_links(text: &str) -> Vec<LinkRef> {
    let mut out: Vec<LinkRef> = Vec::new();
    let push = |out: &mut Vec<LinkRef>, url: String, text: String, line: usize| {
        if !out.iter().any(|l| l.url == url) { out.push(LinkRef { url, text, line }); }
    };
    let mut fence: Option<char> = None;
    for (i, line) in text.lines().enumerate() {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            let c = t.chars().next().unwrap_or('`');
            match fence { None => fence = Some(c), Some(f) if f == c => fence = None, _ => {} }
            continue;
        }
        if fence.is_some() { continue; }
        let mut spans: Vec<(usize, usize)> = Vec::new();
        for c in md_link_re().captures_iter(line) {
            let whole = c.get(0).unwrap();
            spans.push((whole.start(), whole.end()));
            if &c[1] == "!" { continue; }
            push(&mut out, c[3].to_string(), c[2].trim().to_string(), i);
        }
        for m in bare_url_re().find_iter(line) {
            if spans.iter().any(|(s, e)| m.start() >= *s && m.start() < *e) { continue; }
            let url = m.as_str().trim_end_matches(['.', ',', ';', ':', '!', '?', '*', '_', '>']);
            push(&mut out, url.to_string(), String::new(), i);
        }
    }
    out
}

/// Frontmatter `title`, else the first `# ` heading, else the file name without `.md`.
pub fn title_of(rel: &str, meta: &serde_json::Value, body: &str) -> String {
    if let Some(t) = meta.get("title").and_then(|v| v.as_str()).map(str::trim).filter(|t| !t.is_empty()) { return t.to_string(); }
    if let Some(h) = body.lines().find_map(|l| l.strip_prefix("# ")) { return h.trim().to_string(); }
    rel.rsplit('/').next().unwrap_or(rel).trim_end_matches(".md").to_string()
}

/// The first line of ordinary prose in the body, for card previews.
pub fn summary_of(body: &str) -> String {
    let mut fence = false;
    for l in body.lines() {
        let t = l.trim();
        if t.starts_with("```") || t.starts_with("~~~") { fence = !fence; continue; }
        if fence || t.is_empty() { continue; }
        let skip = t.starts_with('#') || t.starts_with("- ") || t.starts_with("* ") || t.starts_with("![") || t.starts_with('|') || t.starts_with("---") || t.starts_with('>') || t.starts_with('<');
        if skip { continue; }
        let mut s: String = t.chars().take(200).collect();
        if t.chars().count() > 200 { s.push('…'); }
        return s;
    }
    String::new()
}

/// `## ` headings outside fenced code.
pub fn count_sections(body: &str) -> usize {
    let mut fence = false;
    body.lines().filter(|l| {
        let t = l.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") { fence = !fence; return false; }
        !fence && l.starts_with("## ")
    }).count()
}

pub fn info_for(root: &Path, rel: &str, text: &str, mtime_ms: u64) -> NoteInfo {
    let parsed = frontmatter::parse(text);
    let note_type = parsed.meta.get("type").and_then(|v| v.as_str()).map(String::from)
        .unwrap_or_else(|| frontmatter::infer_type(rel).to_string());
    let dir = resolve(root, rel).ok().and_then(|p| p.parent().map(|d| d.to_path_buf())).unwrap_or_else(|| root.to_path_buf());
    let (mut media, mut refs) = (Vec::new(), Vec::new());
    for l in links::find_relative_links(text) {
        let target = links::normalize(&dir.join(&l.target));
        let ext = target.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        let r = to_rel(root, &target);
        if ext == "md" { if !refs.contains(&r) { refs.push(r); } continue; }
        if !is_media(&ext) || !target.is_file() { continue; }
        if !media.contains(&r) { media.push(r); }
    }
    let ts = todos::scan_text(rel, text);
    let open: Vec<_> = ts.iter().filter(|t| t.state == "open").collect();
    NoteInfo {
        rel: rel.to_string(),
        title: title_of(rel, &parsed.meta, &parsed.body),
        summary: summary_of(&parsed.body),
        note_type,
        meta: parsed.meta,
        mtime_ms,
        links: find_web_links(text),
        media,
        refs,
        sections: count_sections(&parsed.body),
        todos_open: open.len(),
        todos_done: ts.iter().filter(|t| t.state == "done").count(),
        blockers: open.iter().filter(|t| t.tags.iter().any(|g| g == "blocker")).count(),
        questions: open.iter().filter(|t| t.tags.iter().any(|g| g == "question")).count(),
    }
}

pub fn scan(root: &Path) -> Result<Vec<NoteInfo>> {
    let mut out = Vec::new();
    for rel in vault::list_notes(root)? {
        let p = resolve(root, &rel)?;
        let Ok(text) = std::fs::read_to_string(&p) else { continue };
        let mtime = std::fs::metadata(&p).and_then(|m| m.modified()).ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
        out.push(info_for(root, &rel, &text, mtime));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn web_links_cover_markdown_bare_and_angle_urls_once_each() {
        let t = "See [Spec](https://x.atlassian.net/wiki/spaces/A/pages/1 \"t\") and https://figma.com/file/abc.\n![shot](https://img.example/x.png)\n<https://acme.slack.com/archives/C1/p2> again https://figma.com/file/abc\n```\nhttps://in.code/fence\n```";
        let l = find_web_links(t);
        let urls: Vec<&str> = l.iter().map(|x| x.url.as_str()).collect();
        assert_eq!(urls, vec!["https://x.atlassian.net/wiki/spaces/A/pages/1", "https://figma.com/file/abc", "https://acme.slack.com/archives/C1/p2"]);
        assert_eq!(l[0].text, "Spec");
        assert_eq!(l[2].line, 2);
    }

    #[test]
    fn sections_ignore_fenced_headings_and_h3() {
        assert_eq!(count_sections("## a\n### b\n```\n## not\n```\n## c\n"), 2);
    }

    #[test]
    fn title_prefers_frontmatter_then_heading_then_file_name() {
        let meta = serde_json::json!({"title": "Checkout"});
        assert_eq!(title_of("features/c/feature.md", &meta, "# Other"), "Checkout");
        assert_eq!(title_of("x/PROJ-1.md", &serde_json::json!({}), "intro\n# PROJ-1 — Fix it\n"), "PROJ-1 — Fix it");
        assert_eq!(title_of("x/PROJ-1.md", &serde_json::json!({}), "no heading"), "PROJ-1");
    }

    #[test]
    fn summary_skips_headings_lists_and_media() {
        assert_eq!(summary_of("# T\n\n## Goal\n- [ ] x\n![](a.png)\nLet people save addresses.\nmore"), "Let people save addresses.");
        assert_eq!(summary_of("# T\n## Notes\n"), "");
    }

    #[test]
    fn scan_reports_types_counts_and_existing_media_only() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::create_dir_all(r.join("features/c/assets")).unwrap();
        fs::write(r.join("features/c/assets/a.png"), b"x").unwrap();
        fs::write(r.join("features/c/PROJ-1.md"), "---\ntype: ticket\nstatus: In Progress\n---\n# PROJ-1\n![](assets/a.png)\n![](assets/missing.png)\n- [ ] one #blocker\n- [ ] two #question\n- [x] done\n").unwrap();
        fs::write(r.join("features/c/inbox.md"), "## 2026-10-18 10:00 · Slack\nhttps://acme.slack.com/archives/C1/p2\n").unwrap();
        let all = scan(r).unwrap();
        let t = all.iter().find(|n| n.rel == "features/c/PROJ-1.md").unwrap();
        assert_eq!(t.note_type, "ticket");
        assert_eq!(t.meta["status"], "In Progress");
        assert_eq!(t.media, vec!["features/c/assets/a.png"]);
        assert_eq!((t.todos_open, t.todos_done, t.blockers, t.questions), (2, 1, 1, 1));
        let inbox = all.iter().find(|n| n.rel == "features/c/inbox.md").unwrap();
        assert_eq!(inbox.note_type, "inbox");
        assert_eq!((inbox.links.len(), inbox.sections), (1, 1));
        fs::create_dir_all(r.join("demos/2026-10-23")).unwrap();
        fs::write(r.join("demos/2026-10-23/demo.md"), "## PROJ-1\n[PROJ-1](../../features/c/PROJ-1.md)\n").unwrap();
        let demo = scan(r).unwrap().into_iter().find(|n| n.rel == "demos/2026-10-23/demo.md").unwrap();
        assert_eq!((demo.note_type.as_str(), demo.refs.clone()), ("demo", vec!["features/c/PROJ-1.md".to_string()]));
    }
}
