#![allow(
    unknown_lints,
    clippy::collapsible_match,
    clippy::manual_checked_ops,
    clippy::unnecessary_sort_by,
    clippy::useless_conversion
)]

//! Presentation layer for rayu (terminal UI + offline replay export).
//!
//! This crate holds the `tui` and `video_export` modules that were extracted
//! out of the monolithic root `rayu` crate so they compile as a separate
//! rustc unit. The application core it builds on (server, agent, provider,
//! auth, session, tool, config, ...) lives in `rayucode-app-core` and is
//! re-exported here via `pub use rayucode_app_core::*`, so every existing
//! `crate::<module>` path (e.g. `crate::config`, `crate::server`) keeps
//! resolving unchanged across the tui code. The root `rayu` crate (cli + bin)
//! re-exports this crate via `pub use rayucode_tui::*`.

// Application core: re-export every `rayucode-app-core` module (which itself
// re-exports `rayucode-base`) so `crate::<module>` paths resolve here exactly as
// they did before the split.
pub use rayucode_app_core::*;

// Presentation layer (kept in this crate).
pub mod pre_ui_setup;
pub mod swarm_compose;
pub mod tui;
pub mod video_export;
