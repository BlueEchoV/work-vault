use crate::core::vault::{self, resolve, Result, VaultError};
use regex::Regex;
use serde::Serialize;
use std::path::Path;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Todo { pub note: String, pub line: usize, pub text: String, pub state: String, pub tags: Vec<String> }

fn re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(\s*[-*] \[)( |x|X|>)(\] )(.*)$").unwrap())
}
fn tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?:^|\s)#([A-Za-z0-9_-]+)").unwrap())
}

fn state_of(c: &str) -> &'static str { match c { " " => "open", ">" => "forwarded", _ => "done" } }
fn mark_of(state: &str) -> Result<&'static str> {
    match state { "open" => Ok(" "), "done" => Ok("x"), "forwarded" => Ok(">"), s => Err(VaultError::NotFound(format!("state {s}"))) }
}

/// Lists the todo lines of a note. Lines inside ``` or ~~~ code fences are skipped (a prompt or
/// skill note often quotes markdown todos that are not the user's own).
pub fn scan_text(note_rel: &str, text: &str) -> Vec<Todo> {
    let mut fence: Option<char> = None;
    text.lines().enumerate().filter_map(|(i, line)| {
        let line = line.trim_end_matches('\r');
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            let c = t.chars().next().unwrap_or('`');
            match fence { None => fence = Some(c), Some(f) if f == c => fence = None, _ => {} }
            return None;
        }
        if fence.is_some() { return None; }
        re().captures(line).map(|c| {
            let body = c[4].trim_end().to_string();
            let tags = tag_re().captures_iter(&body).map(|t| t[1].to_string()).collect();
            Todo { note: note_rel.to_string(), line: i, text: body, state: state_of(&c[2]).into(), tags }
        })
    }).collect()
}

pub fn scan_vault(root: &Path) -> Result<Vec<Todo>> {
    let mut out = Vec::new();
    for note in vault::list_notes(root)? {
        let text = std::fs::read_to_string(resolve(root, &note)?)?;
        out.extend(scan_text(&note, &text));
    }
    Ok(out)
}

pub fn set_state(root: &Path, note_rel: &str, line: usize, state: &str) -> Result<()> {
    let mark = mark_of(state)?;
    let p = resolve(root, note_rel)?;
    let text = std::fs::read_to_string(&p)?;
    let mut lines: Vec<&str> = text.split_inclusive('\n').collect();
    let target = lines.get(line).ok_or_else(|| VaultError::NotFound(format!("{note_rel}:{line}")))?;
    let (body, nl) = match target.strip_suffix("\r\n") { Some(b) => (b, "\r\n"), None => match target.strip_suffix('\n') { Some(b) => (b, "\n"), None => (*target, "") } };
    let caps = re().captures(body).ok_or_else(|| VaultError::NotFound(format!("{note_rel}:{line} is not a todo")))?;
    let new_line = format!("{}{}{}{}{}", &caps[1], mark, &caps[3], &caps[4], nl);
    lines[line] = &new_line;
    let joined: String = lines.concat();
    std::fs::write(&p, joined)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_text_finds_states_and_tags() {
        let t = "# h\n- [ ] open one #blocker\n  - [x] nested done\n* [>] fwd #question #a\n- [] not a todo\n-[ ] nope\n";
        let v = scan_text("n.md", t);
        assert_eq!(v.len(), 3);
        assert_eq!((v[0].line, v[0].state.as_str(), v[0].text.as_str()), (1, "open", "open one #blocker"));
        assert_eq!(v[0].tags, vec!["blocker"]);
        assert_eq!((v[1].line, v[1].state.as_str()), (2, "done"));
        assert_eq!((v[2].line, v[2].state.as_str()), (3, "forwarded"));
        assert_eq!(v[2].tags, vec!["question", "a"]);
    }

    #[test]
    fn set_state_preserves_crlf_and_other_lines() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("n.md");
        std::fs::write(&p, "a\r\n- [ ] x\r\nb\r\n").unwrap();
        set_state(d.path(), "n.md", 1, "done").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "a\r\n- [x] x\r\nb\r\n");
        set_state(d.path(), "n.md", 1, "open").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "a\r\n- [ ] x\r\nb\r\n");
        assert!(set_state(d.path(), "n.md", 0, "done").is_err(), "line 0 is not a todo");
    }

    #[test]
    fn scan_vault_covers_all_notes() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("daily")).unwrap();
        std::fs::write(d.path().join("inbox.md"), "- [ ] a").unwrap();
        std::fs::write(d.path().join("daily/2026-10-15.md"), "- [x] b\n- [ ] c").unwrap();
        let v = scan_vault(d.path()).unwrap();
        assert_eq!(v.len(), 3);
        assert_eq!(v[0].note, "daily/2026-10-15.md");
    }
    #[test]
    fn scan_text_skips_fenced_code() {
        let text = "- [ ] real\n```md\n- [ ] fenced\n```\n~~~\n- [x] tilde fenced\n~~~\n- [ ] after";
        let t = scan_text("n.md", text);
        assert_eq!(t.iter().map(|x| x.line).collect::<Vec<_>>(), vec![0, 7]);
    }
}
