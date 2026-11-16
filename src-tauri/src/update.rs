//! Updates from the private GitHub repo's releases. Windows PowerShell does the web calls, so the app
//! needs no web library of its own. The GitHub token goes to PowerShell in an environment variable,
//! never on a command line.
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const REPO: &str = "BlueEchoV/work-vault";
const NO_WINDOW: u32 = 0x0800_0000;
const BREAKAWAY: u32 = 0x0100_0000;

#[derive(serde::Serialize)]
pub struct Update {
    pub version: String,
    /// The installer's API address (downloadable with the token).
    pub asset: String,
}

#[derive(serde::Serialize)]
pub struct Status {
    pub current: String,
    pub has_token: bool,
    pub update: Option<Update>,
}

fn token_file(config: &Path) -> PathBuf { config.join("github-token.txt") }

pub fn save_token(config: &Path, token: &str) -> Result<(), String> {
    std::fs::create_dir_all(config).map_err(|e| e.to_string())?;
    let t = token.trim();
    if t.is_empty() { let _ = std::fs::remove_file(token_file(config)); return Ok(()); }
    std::fs::write(token_file(config), t).map_err(|e| e.to_string())
}

/// The saved token, or else the GitHub CLI's own login if it is installed and signed in.
fn token(config: &Path) -> Option<String> {
    if let Ok(t) = std::fs::read_to_string(token_file(config)) {
        if !t.trim().is_empty() { return Some(t.trim().to_string()); }
    }
    let out = Command::new("gh").args(["auth", "token"]).creation_flags(NO_WINDOW).stdin(Stdio::null()).output().ok()?;
    let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !t.is_empty()).then_some(t)
}

/// A path inside a single-quoted PowerShell string.
fn q(p: &Path) -> String { p.display().to_string().replace('\'', "''") }

fn powershell(script: &str, token: &str) -> Command {
    let mut c = Command::new("powershell");
    c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .env("VAULT_TOKEN", token)
        .stdin(Stdio::null());
    c
}

const PRELUDE: &str = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; \
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; \
    $h=@{Authorization=\"Bearer $env:VAULT_TOKEN\"; 'User-Agent'='Vault'; 'X-GitHub-Api-Version'='2022-11-28'};";

fn run(script: &str, token: &str) -> Result<String, String> {
    let out = powershell(&format!("{PRELUDE} {script}"), token).creation_flags(NO_WINDOW).output().map_err(|e| e.to_string())?;
    if out.status.success() { return Ok(String::from_utf8_lossy(&out.stdout).trim().to_string()); }
    let err = String::from_utf8_lossy(&out.stderr);
    let first = err.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("unknown error");
    Err(if first.contains("(401)") { "GitHub did not accept the token (it may have expired).".into() }
        else if first.contains("(404)") { "GitHub found no release, or the token cannot see the repo.".into() }
        else { first.to_string() })
}

/// `v0.3.1` → (0, 3, 1)
fn parse(v: &str) -> Option<(u32, u32, u32)> {
    let mut p = v.trim().trim_start_matches('v').split('.').map(|x| x.parse::<u32>().ok());
    Some((p.next()??, p.next()??, p.next().flatten().unwrap_or(0)))
}

pub fn newer(latest: &str, current: &str) -> bool {
    matches!((parse(latest), parse(current)), (Some(a), Some(b)) if a > b)
}

pub fn check(config: &Path, current: &str) -> Result<Status, String> {
    let Some(tok) = token(config) else { return Ok(Status { current: current.into(), has_token: false, update: None }) };
    let line = run(&format!(
        "$r=Invoke-RestMethod -Headers $h -Uri 'https://api.github.com/repos/{REPO}/releases/latest'; \
         $a=$r.assets | Where-Object {{ $_.name -like '*-setup.exe' }} | Select-Object -First 1; \
         \"$($r.tag_name)|$($a.url)\""), &tok)?;
    let (tag, asset) = line.split_once('|').ok_or("unexpected answer from GitHub")?;
    let update = (newer(tag, current) && !asset.is_empty())
        .then(|| Update { version: tag.trim_start_matches('v').to_string(), asset: asset.to_string() });
    Ok(Status { current: current.into(), has_token: true, update })
}

/// Downloads the installer, then hands over to a hidden PowerShell that waits for Vault to close,
/// installs silently and starts Vault again. The caller quits the app right after.
pub fn install(config: &Path, asset: &str, exe: &Path) -> Result<(), String> {
    if !asset.starts_with(&format!("https://api.github.com/repos/{REPO}/releases/assets/")) { return Err("not a Vault installer".into()); }
    let tok = token(config).ok_or("no GitHub token saved")?;
    let setup = std::env::temp_dir().join("Vault-update-setup.exe");
    run(&format!("$h.Accept='application/octet-stream'; Invoke-WebRequest -UseBasicParsing -Headers $h -Uri '{asset}' -OutFile '{}'", q(&setup)), &tok)?;
    // What happens is written to `Vault-update.log` in the temp folder, in case it goes wrong.
    let log = std::env::temp_dir().join("Vault-update.log");
    let script = format!(
        "& {{ 'waiting for Vault to close'; Wait-Process -Id {} -ErrorAction SilentlyContinue; 'installing'; \
         Start-Process -Wait -FilePath '{}' -ArgumentList '/S'; 'starting Vault'; Start-Process -FilePath '{}'; 'done' }} *> '{}'",
        std::process::id(), q(&setup), q(exe), q(&log));
    // It must outlive Vault, so it leaves any job that would close it along with Vault when the job
    // allows that. (Not DETACHED_PROCESS: PowerShell quits at once without a console.)
    let spawn = |flags: u32| powershell(&script, "").creation_flags(flags).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
    spawn(NO_WINDOW | BREAKAWAY).or_else(|_| spawn(NO_WINDOW)).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compares_versions() {
        assert!(newer("v0.3.0", "0.2.0"));
        assert!(newer("v0.10.0", "0.9.5"));
        assert!(!newer("v0.2.0", "0.2.0"));
        assert!(!newer("v0.1.9", "0.2.0"));
        assert!(!newer("garbage", "0.2.0"));
    }
}

#[cfg(test)]
mod live {
    /// Really updates the installed Vault from the latest release, as if this were v0.2.0.
    /// Run it outside any job that closes child processes, or the installer is killed with the test.
    #[test]
    #[ignore]
    fn live_update() {
        let config = std::env::temp_dir().join("vault-update-test");
        let st = super::check(&config, "0.2.0").unwrap();
        let up = st.update.expect("no update found");
        println!("found v{} at {}", up.version, up.asset);
        let exe = std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap()).join("Vault").join("work-vault.exe");
        super::install(&config, &up.asset, &exe).unwrap();
    }
}

