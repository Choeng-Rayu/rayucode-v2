//! `/agents profile ...` command logic shared by the TUI and the daemon's
//! runtime commands. Profiles are named, user-recommended models with a note
//! on when the coordinator should use them. They live in global config
//! (`[[agents.profiles]]`) or in a per-session sidecar file.

use crate::config::{AgentProfile, Config};
use crate::session::Session;
use anyhow::{Result, bail};

pub const USAGE: &str = "Usage: /agents [global] profile [list | add <name> <model> [--effort <level>] <when to use> | rm <name>]";

/// Run a profile subcommand. `args` excludes the leading `profile` word.
/// `global` writes `~/.rayu/config.toml`, otherwise the session sidecar.
pub fn run(session: &Session, global: bool, args: &[String]) -> Result<String> {
    match args.split_first() {
        None => Ok(render(session)),
        Some((verb, _)) if matches!(verb.as_str(), "list" | "ls" | "show") => Ok(render(session)),
        Some((verb, rest)) if matches!(verb.as_str(), "add" | "set") => {
            let profile = parse_add(rest)?;
            let saved = if global {
                Config::upsert_agent_profile(profile.clone())?;
                crate::session::normalize_profile(profile)?
            } else {
                session.upsert_session_agent_profile(profile)?
            };
            Ok(format!(
                "Saved {} profile `{}` → {}.\n\n{}",
                scope_label(global),
                saved.name,
                saved.model,
                render(session)
            ))
        }
        Some((verb, rest)) if matches!(verb.as_str(), "rm" | "remove" | "delete") => {
            let [name] = rest else { bail!("{USAGE}") };
            let removed = if global {
                Config::remove_agent_profile(name)?
            } else {
                session.remove_session_agent_profile(name)?
            };
            if !removed {
                bail!("No {} profile named `{name}`.", scope_label(global));
            }
            Ok(format!(
                "Removed {} profile `{name}`.\n\n{}",
                scope_label(global),
                render(session)
            ))
        }
        Some((verb, _)) if matches!(verb.as_str(), "dismiss" | "skip") => {
            Config::set_agent_profile_setup_hint(false)?;
            Ok("Agent profile setup hint dismissed. The main agent will pick worker models itself.".to_string())
        }
        _ => bail!("{USAGE}"),
    }
}

fn scope_label(global: bool) -> &'static str {
    if global { "global" } else { "session" }
}

/// Parse `<name> <model> [--effort <level>] <description...>`.
pub fn parse_add(args: &[String]) -> Result<AgentProfile> {
    let mut iter = args.iter();
    let (Some(name), Some(model)) = (iter.next(), iter.next()) else {
        bail!("{USAGE}");
    };
    let mut effort = None;
    let mut description = Vec::new();
    while let Some(arg) = iter.next() {
        if arg == "--effort" {
            let Some(value) = iter.next() else {
                bail!("Missing value for --effort");
            };
            effort = Some(value.clone());
        } else {
            description.push(arg.as_str());
        }
    }
    let description = description
        .join(" ")
        .trim_matches(|c| c == '"' || c == '\'')
        .to_string();
    Ok(AgentProfile {
        name: name.clone(),
        model: model.clone(),
        description,
        effort,
    })
}

/// Human-readable profile listing with scope markers.
pub fn render(session: &Session) -> String {
    let global = crate::config::config().agents.profiles.clone();
    let local = session.session_agent_profiles();
    let effective = session.effective_agent_profiles();
    if effective.is_empty() {
        return format!(
            "No agent profiles yet. Without profiles the main agent picks a model per worker from the live catalog.\n\nAdd one:\n  /agents profile add research gemini:gemini-2.5-pro Web research and long reading\n  /agents global profile add coder claude:claude-sonnet-4-6 --effort medium Code edits and refactors\n\nRole targets accept profile names too, e.g. /agents review research.\n{USAGE}"
        );
    }
    let mut out = String::from("Agent profiles (session overrides global):\n");
    for profile in &effective {
        let scope = if local
            .iter()
            .any(|p| p.name.eq_ignore_ascii_case(&profile.name))
        {
            "session"
        } else if global
            .iter()
            .any(|p| p.name.eq_ignore_ascii_case(&profile.name))
        {
            "global"
        } else {
            "?"
        };
        out.push_str(&format!("- {} [{scope}] → {}", profile.name, profile.model));
        if let Some(effort) = &profile.effort {
            out.push_str(&format!(" (effort {effort})"));
        }
        if !profile.description.is_empty() {
            out.push_str(&format!(": {}", profile.description));
        }
        out.push('\n');
    }
    out.push_str(
        "\nThe main agent sees these and assigns one per worker. Role targets accept profile names, e.g. /agents review <profile>.",
    );
    out
}

/// Launch hint shown once per session while the user has no profiles.
pub fn setup_hint(session: &Session) -> Option<String> {
    let agents = &crate::config::config().agents;
    if !agents.profile_setup_hint || !session.effective_agent_profiles().is_empty() {
        return None;
    }
    Some(
        "Tip: set agent profiles so the main agent knows which model to give each kind of worker, e.g. `/agents global profile add coder claude:claude-sonnet-4-6 Code edits`. Until then it picks models itself. `/agents profile dismiss` hides this."
            .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(s: &str) -> Vec<String> {
        s.split_whitespace().map(str::to_string).collect()
    }

    #[test]
    fn parse_add_reads_effort_and_description() {
        let profile = parse_add(&args("Coder claude:sonnet --effort high Code edits")).unwrap();
        assert_eq!(profile.name, "Coder");
        assert_eq!(profile.model, "claude:sonnet");
        assert_eq!(profile.effort.as_deref(), Some("high"));
        assert_eq!(profile.description, "Code edits");
        assert!(parse_add(&args("only-name")).is_err());
        assert!(parse_add(&args("a b --effort")).is_err());
    }
}
