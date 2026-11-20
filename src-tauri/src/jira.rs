//! Read-only Jira. The app can only send GET requests to `/rest/api/` on the saved Jira site, so it can
//! look things up but never change anything there. The site and email live in `jira.json` in the app's
//! config folder; the API token lives in Windows Credential Manager, never in a file.
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct Settings {
    site: String,
    email: String,
}

#[derive(serde::Serialize)]
pub struct Status {
    pub site: String,
    pub email: String,
    pub has_token: bool,
}

fn settings_file(config: &Path) -> PathBuf { config.join("jira.json") }

fn load(config: &Path) -> Settings {
    std::fs::read_to_string(settings_file(config)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn keyring() -> Result<keyring::Entry, String> { keyring::Entry::new("Vault", "jira-api-token").map_err(|e| e.to_string()) }

fn token() -> Option<String> {
    keyring().ok()?.get_password().ok().map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

/// `acme.atlassian.net`, `https://acme.atlassian.net/browse/X-1` → `https://acme.atlassian.net`
pub fn normalize_site(site: &str) -> Result<String, String> {
    let s = site.trim();
    if s.is_empty() { return Ok(String::new()); }
    if s.starts_with("http://") { return Err("The Jira site must use https.".into()); }
    let host = s.trim_start_matches("https://").split(['/', '?', '#']).next().unwrap_or("");
    let ok = !host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':');
    if !ok { return Err("That does not look like a Jira site, like acme.atlassian.net.".into()); }
    Ok(format!("https://{}", host.to_ascii_lowercase()))
}

pub fn status(config: &Path) -> Status {
    let s = load(config);
    Status { site: s.site, email: s.email, has_token: token().is_some() }
}

/// Saves the site and email, and the token when one is given (an empty token keeps the saved one).
pub fn setup(config: &Path, site: &str, email: &str, new_token: &str) -> Result<Status, String> {
    let s = Settings { site: normalize_site(site)?, email: email.trim().to_string() };
    std::fs::create_dir_all(config).map_err(|e| e.to_string())?;
    std::fs::write(settings_file(config), serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let t = new_token.trim();
    if !t.is_empty() { keyring()?.set_password(t).map_err(|e| format!("Could not save the token: {e}"))?; }
    Ok(status(config))
}

/// One connection pool for the whole app. Windows' own TLS, so it trusts the same certificates as the
/// browser (company proxies included).
fn agent() -> Result<&'static ureq::Agent, String> {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    if let Some(a) = AGENT.get() { return Ok(a); }
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    let a = ureq::AgentBuilder::new()
        .tls_connector(Arc::new(tls))
        .try_proxy_from_env(true)
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent("Vault")
        .build();
    Ok(AGENT.get_or_init(|| a))
}

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            out.push(if i <= c.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

/// Only reads: a path under `/rest/api/` on the saved site, nothing that could leave it.
pub fn allowed(path: &str) -> bool {
    path.starts_with("/rest/api/") && !path.contains("..") && !path.contains("//") && !path.chars().any(|c| c.is_control() || c == '\\' || c == '@')
}

/// Jira's own words for a refused request (like a JQL mistake), when it gives them.
fn jira_message(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let first = v["errorMessages"].as_array().and_then(|a| a.first()).and_then(|m| m.as_str()).map(str::to_string);
    first.or_else(|| v["errors"].as_object().and_then(|o| o.values().next()).and_then(|m| m.as_str()).map(str::to_string))
}

/// GETs `path` from Jira and returns the JSON text.
pub fn get(config: &Path, path: &str) -> Result<String, String> {
    if !allowed(path) { return Err("Vault only reads from Jira.".into()); }
    let s = load(config);
    if s.site.is_empty() || s.email.is_empty() { return Err("Jira is not set up yet.".into()); }
    let tok = token().ok_or("No Jira API token is saved.")?;
    fetch(&s.site, &s.email, &tok, path)
}

fn fetch(site: &str, email: &str, tok: &str, path: &str) -> Result<String, String> {
    let auth = format!("Basic {}", base64(format!("{email}:{tok}").as_bytes()));
    const REFUSED: &str = "Jira did not accept your API token. It may have expired or been revoked, or the email is wrong.";
    // With a bad token Jira often answers anyway, as if nobody were signed in (empty searches, "not found"),
    // and only says so in this header.
    let refused = |r: &ureq::Response| r.header("X-Seraph-LoginReason").is_some_and(|v| v.contains("AUTHENTICATED_FAILED") || v.contains("AUTHENTICATION_DENIED"));
    match agent()?.get(&format!("{site}{path}")).set("Authorization", &auth).set("Accept", "application/json").call() {
        Ok(r) if refused(&r) => Err(REFUSED.into()),
        Ok(r) => r.into_string().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(_, r)) if refused(&r) => Err(REFUSED.into()),
        Err(ureq::Error::Status(code, r)) => {
            let said = r.into_string().ok().as_deref().and_then(jira_message);
            Err(match code {
                401 => REFUSED.into(),
                403 => said.unwrap_or_else(|| "Jira says you are not allowed to see that.".into()),
                404 => said.unwrap_or_else(|| "Jira found nothing there, or you cannot see it.".into()),
                429 => "Jira asked Vault to slow down. Try again in a minute.".into(),
                _ => said.unwrap_or_else(|| format!("Jira answered with error {code}.")),
            })
        }
        Err(e) => Err(format!("Could not reach Jira: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_base64() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"me@x.com:tok"), "bWVAeC5jb206dG9r");
    }

    #[test]
    fn cleans_the_site() {
        assert_eq!(normalize_site("acme.atlassian.net").unwrap(), "https://acme.atlassian.net");
        assert_eq!(normalize_site(" https://Acme.atlassian.net/browse/X-1 ").unwrap(), "https://acme.atlassian.net");
        assert!(normalize_site("http://acme.atlassian.net").is_err());
        assert!(normalize_site("acme net").is_err());
    }

    #[test]
    fn only_reads_api_paths() {
        assert!(allowed("/rest/api/3/issue/ABC-1?fields=summary"));
        assert!(allowed("/rest/api/3/search/jql?jql=text%20~%20%22x%22"));
        assert!(!allowed("/secure/Dashboard.jspa"));
        assert!(!allowed("/rest/api/../../evil"));
        assert!(!allowed("/rest/api//@evil.com/"));
        assert!(!allowed("/rest/api/3/issue\r\nX: y"));
    }

    #[test]
    fn reads_jira_errors() {
        assert_eq!(jira_message(r#"{"errorMessages":["Bad JQL"],"errors":{}}"#).as_deref(), Some("Bad JQL"));
        assert_eq!(jira_message(r#"{"errorMessages":[],"errors":{"jql":"Nope"}}"#).as_deref(), Some("Nope"));
        assert_eq!(jira_message("not json"), None);
    }
}

#[cfg(test)]
mod live {
    use serde_json::Value;

    /// A wrong or expired token gets the token message everywhere, not empty results or "not found".
    #[test]
    #[ignore]
    fn live_bad_token() {
        let config = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.workvault.app");
        let site = super::status(&config).site;
        for p in ["/rest/api/3/myself", "/rest/api/3/search/jql?jql=assignee%3DcurrentUser()&fields=summary&maxResults=5", "/rest/api/3/issue/ANDAPP-31101?fields=summary"] {
            let r = super::fetch(&site, "nobody@example.com", "not-a-real-token", p);
            println!("{p} -> {r:?}");
            assert!(r.as_ref().is_err_and(|e| e.starts_with("Jira did not accept")), "{p}");
        }
    }

    /// Makes the same requests the Jira tab makes, against the real site saved by the installed app
    /// (connect Jira in Vault first). Set VAULT_JIRA_KEY to a ticket or epic key to read that one.
    /// Prints what Vault would show; never prints the token.
    #[test]
    #[ignore]
    fn live_jira() {
        let config = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.workvault.app");
        let st = super::status(&config);
        assert!(st.has_token && !st.site.is_empty(), "connect Jira in Vault first");
        let get = |p: &str| -> Value { serde_json::from_str(&super::get(&config, p).unwrap_or_else(|e| panic!("{p}: {e}"))).unwrap() };
        let enc = |s: &str| s.bytes().map(|b| if b.is_ascii_alphanumeric() { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>();
        const BRIEF: &str = "summary,status,issuetype,assignee,priority";

        println!("site: {}", st.site);
        let me = get("/rest/api/3/myself");
        println!("signed in as: {}", me["displayName"]);

        // The person picker: Jira's people search, then someone's tickets by account id.
        let first = me["displayName"].as_str().unwrap_or("").split(' ').next().unwrap_or("").to_string();
        let people = get(&format!("/rest/api/3/user/search?query={}&maxResults=20", enc(&first)));
        let people = people.as_array().unwrap();
        println!("people search for {first:?}: {} ({} people)", people.len(), people.iter().filter(|u| u["accountType"] == "atlassian" && u["active"] != false).count());
        for u in people.iter().take(3) { println!("  {} [{}]", u["displayName"], u["accountType"]); }
        let id = me["accountId"].as_str().unwrap();
        println!("by id: {}", get(&format!("/rest/api/3/user?accountId={}", enc(id)))["displayName"]);
        let theirs = get(&format!("/rest/api/3/search/jql?jql={}&fields=summary&maxResults=100", enc(&format!("assignee = \"{id}\" AND statusCategory != Done"))));
        println!("open tickets by account id: {}", theirs["issues"].as_array().unwrap().len());
        let sprint = get("/rest/api/3/field").as_array().unwrap().iter()
            .find(|f| f["schema"]["custom"] == "com.pyxis.greenhopper.jira:gh-sprint").map(|f| f["id"].as_str().unwrap().to_string());
        println!("sprint field: {sprint:?}");

        let jql = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
        let mine = get(&format!("/rest/api/3/search/jql?jql={}&fields={BRIEF}&maxResults=100", enc(jql)));
        let mine = mine["issues"].as_array().unwrap();
        println!("assigned to me: {}", mine.len());
        for i in mine.iter().take(5) { println!("  {} {} [{}]", i["key"], i["fields"]["summary"], i["fields"]["status"]["name"]); }

        let key = std::env::var("VAULT_JIRA_KEY").ok().or_else(|| mine.first().map(|i| i["key"].as_str().unwrap().to_string())).expect("no ticket to read");
        let fields = format!("{BRIEF},reporter,parent,labels,updated,description,issuelinks,subtasks,comment{}", sprint.as_ref().map(|s| format!(",{s}")).unwrap_or_default());
        let i = get(&format!("/rest/api/3/issue/{key}?fields={fields}"));
        let f = &i["fields"];
        println!("\n{} {}", i["key"], f["summary"]);
        println!("  type: {} (level {})  status: {}  assignee: {}", f["issuetype"]["name"], f["issuetype"]["hierarchyLevel"], f["status"]["name"], f["assignee"]["displayName"]);
        println!("  parent: {}  sprint: {}", f["parent"]["key"], sprint.as_ref().map(|s| f[s].to_string()).unwrap_or_default());
        println!("  description nodes: {}  links: {}  subtasks: {}  comments: {}",
            f["description"]["content"].as_array().map_or(0, |a| a.len()), f["issuelinks"].as_array().map_or(0, |a| a.len()),
            f["subtasks"].as_array().map_or(0, |a| a.len()), f["comment"]["total"]);
        if f["issuetype"]["hierarchyLevel"].as_i64().unwrap_or(0) >= 1 {
            let kids = get(&format!("/rest/api/3/search/jql?jql={}&fields={BRIEF}&maxResults=100", enc(&format!("parent = {key} ORDER BY key ASC"))));
            let kids = kids["issues"].as_array().unwrap();
            println!("  children: {}", kids.len());
            for k in kids { println!("    {} {} [{}]", k["key"], k["fields"]["summary"], k["fields"]["status"]["name"]); }
        }
    }
}
