//! Runs Claude Code headless in the vault for the vault's own slash commands (`/organize`, `/demo-script`).
//! Claude may only read and edit files; every run sits between two git commits so it can be undone.
use crate::core::vault::{resolve, Result, VaultError};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The `claude` executable: on PATH, else the native installer's default location.
pub fn find() -> Option<PathBuf> {
    let mut c = Command::new(if cfg!(windows) { "where" } else { "which" });
    c.arg("claude").stdin(Stdio::null());
    no_window(&mut c);
    if let Ok(out) = c.output() {
        if out.status.success() {
            let first = String::from_utf8_lossy(&out.stdout).lines().map(str::trim).find(|l| !l.is_empty()).map(PathBuf::from);
            if first.as_ref().is_some_and(|p| p.is_file()) { return first; }
        }
    }
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    let p = PathBuf::from(home).join(".local").join("bin").join(if cfg!(windows) { "claude.exe" } else { "claude" });
    p.is_file().then_some(p)
}

fn no_window(c: &mut Command) {
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; c.creation_flags(0x08000000); }
    #[cfg(not(windows))]
    { let _ = c; }
}

/// The prompt for `.claude/commands/<name>.md` with `$ARGUMENTS` filled in.
pub fn command_prompt(root: &Path, name: &str, args: &str) -> Result<String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(VaultError::Invalid(format!("bad command name {name}")));
    }
    let p = resolve(root, &format!(".claude/commands/{name}.md"))?;
    let text = std::fs::read_to_string(&p).map_err(|_| VaultError::NotFound(format!(".claude/commands/{name}.md")))?;
    Ok(text.replace("$ARGUMENTS", args.trim()))
}

/// Runs `claude -p` in `root` with file tools only. Returns what Claude printed.
pub fn run(exe: &Path, root: &Path, prompt: &str, timeout: Duration) -> Result<String> {
    let mut c = Command::new(exe);
    c.current_dir(root)
        .args(["-p", prompt, "--output-format", "text", "--permission-mode", "acceptEdits", "--allowedTools", "Read,Edit,Write,Glob,Grep"])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    no_window(&mut c);
    let mut child = c.spawn().map_err(|e| VaultError::Invalid(format!("could not start Claude Code: {e}")))?;
    // Drain both pipes on their own threads so a chatty run cannot block on a full pipe.
    let mut so = child.stdout.take().unwrap();
    let mut se = child.stderr.take().unwrap();
    let out_t = std::thread::spawn(move || { let mut s = String::new(); let _ = std::io::Read::read_to_string(&mut so, &mut s); s });
    let err_t = std::thread::spawn(move || { let mut s = String::new(); let _ = std::io::Read::read_to_string(&mut se, &mut s); s });
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait()? { break s; }
        if start.elapsed() > timeout {
            let _ = child.kill();
            return Err(VaultError::Invalid(format!("Claude Code did not finish within {} minutes and was stopped", timeout.as_secs() / 60)));
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    let out = out_t.join().unwrap_or_default();
    let err = err_t.join().unwrap_or_default();
    if !status.success() {
        let msg = if err.trim().is_empty() { out.trim() } else { err.trim() };
        return Err(VaultError::Invalid(format!("Claude Code failed: {msg}")));
    }
    Ok(out.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn command_prompt_fills_arguments_and_rejects_odd_names() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".claude/commands")).unwrap();
        std::fs::write(d.path().join(".claude/commands/organize.md"), "Source: $ARGUMENTS.").unwrap();
        assert_eq!(command_prompt(d.path(), "organize", " inbox.md ").unwrap(), "Source: inbox.md.");
        assert!(command_prompt(d.path(), "../x", "").is_err());
        assert!(command_prompt(d.path(), "missing", "").is_err());
    }
}
