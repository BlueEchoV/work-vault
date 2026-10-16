use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct Link { pub start: usize, pub end: usize, pub target: String }

fn is_external(t: &str) -> bool {
    t.starts_with('#') || t.starts_with("mailto:") || t.starts_with("data:") || t.contains("://")
}

pub fn find_relative_links(text: &str) -> Vec<Link> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b']' && bytes[i + 1] == b'(' {
            let open = i + 2;
            let mut j = open;
            let mut depth = 0i32;
            let mut close = None;
            while j < bytes.len() {
                match bytes[j] {
                    b'(' => depth += 1,
                    b')' if depth == 0 => { close = Some(j); break; }
                    b')' => depth -= 1,
                    b'\n' => break,
                    _ => {}
                }
                j += 1;
            }
            if let Some(close) = close {
                let inner = &text[open..close];
                let trimmed = inner.trim_start();
                let lead = inner.len() - trimmed.len();
                let (target, tlen) = if let Some(rest) = trimmed.strip_prefix('<') {
                    match rest.find('>') { Some(k) => (&rest[..k], k + 2), None => (trimmed, trimmed.len()) }
                } else {
                    let k = trimmed.find(char::is_whitespace).unwrap_or(trimmed.len());
                    (&trimmed[..k], k)
                };
                let (ts, te) = if trimmed.starts_with('<') { (open + lead + 1, open + lead + tlen - 1) } else { (open + lead, open + lead + tlen) };
                if !target.is_empty() && !is_external(target) {
                    out.push(Link { start: ts, end: te, target: target.to_string() });
                }
                i = close + 1;
                continue;
            }
        }
        i += 1;
    }
    out
}

pub fn rewrite_links(text: &str, f: &mut dyn FnMut(&str) -> Option<String>) -> String {
    let links = find_relative_links(text);
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for l in links {
        if let Some(new) = f(&l.target) {
            out.push_str(&text[last..l.start]);
            out.push_str(&new);
            last = l.end;
        }
    }
    out.push_str(&text[last..]);
    out
}

pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => { out.pop(); }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub fn relative_path(from_dir: &Path, to: &Path) -> String {
    let from: Vec<_> = normalize(from_dir).components().map(|c| c.as_os_str().to_os_string()).collect();
    let to: Vec<_> = normalize(to).components().map(|c| c.as_os_str().to_os_string()).collect();
    let common = from.iter().zip(to.iter()).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<String> = vec!["..".to_string(); from.len() - common];
    parts.extend(to[common..].iter().map(|s| s.to_string_lossy().to_string()));
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_image_and_plain_relative_links_only() {
        let t = "a ![x](assets/a.png) b [t](../other/n.md \"title\") c [u](https://x.y/z) d [m](mailto:a@b) e [h](#sec) f ![v](<assets/my video.mp4>)";
        let l = find_relative_links(t);
        let targets: Vec<&str> = l.iter().map(|x| x.target.as_str()).collect();
        assert_eq!(targets, vec!["assets/a.png", "../other/n.md", "assets/my video.mp4"]);
        assert_eq!(&t[l[0].start..l[0].end], "assets/a.png");
    }

    #[test]
    fn rewrite_replaces_only_mapped_targets() {
        let t = "![a](assets/a.png) [b](assets/b.png)";
        let out = rewrite_links(t, &mut |x| if x == "assets/a.png" { Some("../z/a.png".into()) } else { None });
        assert_eq!(out, "![a](../z/a.png) [b](assets/b.png)");
    }

    #[test]
    fn relative_path_uses_dotdot_and_slashes() {
        assert_eq!(relative_path(Path::new("v/features/a"), Path::new("v/features/b/assets/x.png")), "../b/assets/x.png");
        assert_eq!(relative_path(Path::new("v/features/a"), Path::new("v/features/a/assets/x.png")), "assets/x.png");
        assert_eq!(relative_path(Path::new("v"), Path::new("v/assets/x.png")), "assets/x.png");
    }

    #[test]
    fn normalize_collapses_dotdot() {
        assert_eq!(normalize(Path::new("v/features/a/../b/./x.md")), PathBuf::from("v/features/b/x.md"));
    }
}
