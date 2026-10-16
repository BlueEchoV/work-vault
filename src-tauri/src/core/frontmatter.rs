use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    pub meta: Value,
    pub body: String,
    pub has_frontmatter: bool,
}

pub fn parse(text: &str) -> Parsed {
    let empty = || Parsed { meta: Value::Object(Default::default()), body: text.to_string(), has_frontmatter: false };
    let rest = match text.strip_prefix("---\r\n").or_else(|| text.strip_prefix("---\n")) {
        Some(r) => r,
        None => return empty(),
    };
    // find closing delimiter on its own line
    let mut offset = 0usize;
    let close = loop {
        let line_end = match rest[offset..].find('\n') { Some(i) => offset + i, None => return empty() };
        let line = rest[offset..line_end].trim_end_matches('\r');
        if line == "---" { break (offset, line_end + 1); }
        offset = line_end + 1;
    };
    let yaml = &rest[..close.0];
    match serde_yaml::from_str::<Value>(yaml) {
        Ok(Value::Object(m)) => Parsed { meta: Value::Object(m), body: rest[close.1..].to_string(), has_frontmatter: true },
        Ok(Value::Null) => Parsed { meta: Value::Object(Default::default()), body: rest[close.1..].to_string(), has_frontmatter: true },
        _ => empty(),
    }
}

pub fn serialize(meta: &Value, body: &str) -> String {
    match meta {
        Value::Object(m) if !m.is_empty() => {
            let yaml = serde_yaml::to_string(meta).unwrap_or_default();
            format!("---\n{}---\n{}", yaml, body)
        }
        _ => body.to_string(),
    }
}

pub fn infer_type(rel: &str) -> &'static str {
    let rel = rel.replace('\\', "/");
    let parts: Vec<&str> = rel.split('/').collect();
    match parts.as_slice() {
        ["features", _, "feature.md"] => "feature",
        ["features", _, f] if f.ends_with(".md") => "ticket",
        ["daily", f] if f.ends_with(".md") => "daily",
        ["ai", "prompts", ..] => "prompt",
        ["ai", "skills", ..] => "skill",
        _ => "note",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_without_frontmatter() {
        let p = parse("# Hi\n\nbody");
        assert!(!p.has_frontmatter);
        assert_eq!(p.body, "# Hi\n\nbody");
        assert_eq!(p.meta, Value::Object(Default::default()));
    }

    #[test]
    fn parse_with_frontmatter_and_crlf() {
        let p = parse("---\r\ntype: ticket\r\njira: PROJ-1\r\ntags: [a, b]\r\n---\r\n# T\r\n");
        assert!(p.has_frontmatter);
        assert_eq!(p.meta["type"], "ticket");
        assert_eq!(p.meta["jira"], "PROJ-1");
        assert_eq!(p.meta["tags"][1], "b");
        assert_eq!(p.body, "# T\r\n");
    }

    #[test]
    fn invalid_yaml_is_treated_as_body() {
        let text = "---\n: : :\n---\nbody";
        let p = parse(text);
        assert!(!p.has_frontmatter);
        assert_eq!(p.body, text);
    }

    #[test]
    fn serialize_round_trips() {
        let meta = serde_json::json!({"type": "ticket", "jira": "PROJ-2"});
        let out = serialize(&meta, "# body\n");
        let back = parse(&out);
        assert_eq!(back.meta, meta);
        assert_eq!(back.body, "# body\n");
    }

    #[test]
    fn serialize_empty_meta_emits_no_frontmatter() {
        assert_eq!(serialize(&serde_json::json!({}), "x"), "x");
    }

    #[test]
    fn infer_type_from_path() {
        assert_eq!(infer_type("features/checkout/feature.md"), "feature");
        assert_eq!(infer_type("features/checkout/PROJ-1.md"), "ticket");
        assert_eq!(infer_type("daily/2026-10-15.md"), "daily");
        assert_eq!(infer_type("ai/prompts/x.md"), "prompt");
        assert_eq!(infer_type("ai/skills/x.md"), "skill");
        assert_eq!(infer_type("inbox.md"), "note");
    }
}
