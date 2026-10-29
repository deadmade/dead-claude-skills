//! The flow cockpit: a window over the user's flow runs, audits and Claude sessions, drawn by views that come in
//! extensions. It reads and never writes: the core's index, the extensions folders, and the user's hand-edited
//! `config.toml`.

// A release build on Windows opens no console window; `--version` and friends attach to the parent's console.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(test)]
mod bindings;
mod commands;
mod paths;
mod poll;
mod strip;
mod trust;
mod views;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::thread;

use flow_cockpit_core::index::{Home, Index};
use include_dir::{Dir, include_dir};
use jiff::Timestamp;
use tauri::Emitter;

use crate::commands::Shared;
use crate::paths::{Defaults, NoHome, Platform};
use crate::poll::{ConfigFile, Event, Poller};
use crate::views::Views;

/// The generated TypeScript types, embedded for `--print-types`.
static BINDINGS: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/../bindings");

fn main() -> ExitCode {
    #[cfg(target_os = "linux")]
    if should_disable_dmabuf(std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").as_deref()) {
        // SAFETY: this runs first in `main`, before Tauri or any other thread exists, so nothing reads the
        // environment while it changes.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        [] => run(),
        ["--version"] => print(&format!("flow-cockpit {}\n", env!("CARGO_PKG_VERSION"))),
        ["--print-types"] => print(&types()),
        ["--print-paths"] => {
            let env = |key: &str| std::env::var(key).ok();
            match paths::config_dir(env, Platform::current()) {
                Ok(config_dir) => print(&paths_text(&default_extensions(env), &config_dir)),
                Err(e) => fail(&format!("flow-cockpit: {e}\n")),
            }
        }
        _ => fail("usage: flow-cockpit [--version | --print-types | --print-paths]\n"),
    }
}

/// `WebKitGTK`'s DMA-BUF renderer kills the window on NVIDIA under Wayland, so it is turned off unless the user set
/// `WEBKIT_DISABLE_DMABUF_RENDERER` themselves (`0` brings it back).
#[cfg(target_os = "linux")]
fn should_disable_dmabuf(current: Option<&std::ffi::OsStr>) -> bool {
    current.is_none()
}

/// Opens the window: builds the index from the transcripts' heads, starts the poll and serves the commands.
fn run() -> ExitCode {
    let env = |key: &str| std::env::var(key).ok();
    let (home, config_dir) = match folders(env, Platform::current()) {
        Ok(folders) => folders,
        Err(e) => return fail(&format!("flow-cockpit: {e}\n")),
    };
    let settings = ConfigFile::load(config_dir.join("config.toml"));
    let index = Index::build(&home, &settings.config, Timestamp::now());
    let views = Views::new(
        default_extensions(env),
        config_dir.join("extensions"),
        settings.config.disabled.clone(),
        &settings.config.trusted,
    );
    let shared = Arc::new(Shared::new(index, views));
    let poll_shared = Arc::clone(&shared);
    let result = tauri::Builder::default()
        .manage(shared)
        .invoke_handler(tauri::generate_handler![
            commands::projects,
            commands::entries,
            commands::flow_run,
            commands::doc,
            commands::session,
            commands::tool_input,
            commands::views,
            commands::view_source,
            commands::extensions,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let mut poller = Poller::new(home, settings, &poll_shared);
            thread::spawn(move || {
                poll::run(&poll_shared, &mut poller, |event| {
                    let sent = match event {
                        Event::Changed(changed) => handle.emit("changed", changed),
                        Event::ViewsChanged => handle.emit("views-changed", ()),
                    };
                    if let Err(e) = sent {
                        eprintln!("flow-cockpit: {e}");
                    }
                });
            });
            Ok(())
        })
        .run(tauri::generate_context!());
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => fail(&format!("flow-cockpit: {e}\n")),
    }
}

/// Where the window reads: Claude's transcripts and the capture files, and the folder of the user's extensions and
/// `config.toml`. Without a home folder to find them in, nothing is read.
fn folders(
    env: impl Fn(&str) -> Option<String>,
    platform: Platform,
) -> Result<(Home, PathBuf), NoHome> {
    let home = Home {
        claude_projects: paths::claude_projects(&env, platform)?,
        capture_dir: paths::capture_dir(&env, platform)?,
    };
    Ok((home, paths::config_dir(&env, platform)?))
}

/// The default extensions folder for the running program.
fn default_extensions(env: impl Fn(&str) -> Option<String>) -> Defaults {
    let exe = std::env::current_exe().ok();
    paths::default_extensions(env, exe.as_deref())
}

/// `--print-paths`: the folders the window reads its extensions and settings from, one per line with a label.
fn paths_text(defaults: &Defaults, config_dir: &Path) -> String {
    let found = if let Some(dir) = &defaults.found {
        dir.display().to_string()
    } else {
        let looked: Vec<String> = defaults
            .looked
            .iter()
            .map(|p| p.display().to_string())
            .collect();
        format!("none found (looked in {})", looked.join(", "))
    };
    format!(
        "default extensions: {found}\nuser extensions: {}\nconfig: {}\n",
        config_dir.join("extensions").display(),
        config_dir.join("config.toml").display()
    )
}

/// The view interface, embedded for `--print-types`.
static API: &str = include_str!("../shell/api.d.ts");

/// The view interface and the bindings as one declaration file, declaring the module `flow-cockpit` that views import
/// their types from: each type once, without the imports and re-exports between them.
fn types() -> String {
    let mut files: Vec<_> = BINDINGS
        .files()
        .filter(|f| f.path().extension().is_some_and(|e| e == "ts"))
        .collect();
    files.sort_by_key(|f| f.path());
    let files = files.iter().map(|f| f.contents_utf8().unwrap_or_default());
    let mut out = String::from(
        "// The flow cockpit's view interface and data types, from `flow-cockpit --print-types`. Generated: do not edit.\n\
         // A view imports them with `import type { View } from 'flow-cockpit';`.\n\
         declare module 'flow-cockpit' {\n",
    );
    for text in std::iter::once(API).chain(files) {
        let text = text.replace("\r\n", "\n");
        for line in text.lines() {
            if line.starts_with("import type ")
                || line.starts_with("export type * from ")
                || line.starts_with("// This file was generated")
            {
                continue;
            }
            out.push_str(line);
            out.push('\n');
        }
    }
    out.push_str("}\n");
    out
}

fn print(text: &str) -> ExitCode {
    attach_console();
    let mut out = std::io::stdout().lock();
    match out.write_all(text.as_bytes()).and_then(|()| out.flush()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => ExitCode::FAILURE,
    }
}

fn fail(text: &str) -> ExitCode {
    attach_console();
    // Nothing more to do when stderr is gone too.
    let _ = std::io::stderr().write_all(text.as_bytes());
    ExitCode::from(2)
}

/// A Windows GUI program starts without a console. When its standard handles were inherited (a pipe, a file), they
/// are used as they are; only when stdout is missing does it attach to the parent's console, so `flow-cockpit
/// --version` typed in a terminal prints there.
#[cfg(windows)]
fn attach_console() {
    use std::ffi::c_void;

    // The Win32 headers define these as `(DWORD)-11` and `(DWORD)-1`; `INVALID_HANDLE_VALUE` is `(HANDLE)-1`.
    const STD_OUTPUT_HANDLE: u32 = (-11_i32).cast_unsigned();
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    const INVALID_HANDLE_VALUE: usize = usize::MAX;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetStdHandle(std_handle: u32) -> *mut c_void;
        fn AttachConsole(process_id: u32) -> i32;
    }

    // SAFETY: both functions take plain integers and touch no memory of ours; GetStdHandle only returns a handle,
    // which is compared and never used here. AttachConsole failing (no parent console) leaves things as they were.
    unsafe {
        let handle = GetStdHandle(STD_OUTPUT_HANDLE);
        if handle.is_null() || handle.addr() == INVALID_HANDLE_VALUE {
            AttachConsole(ATTACH_PARENT_PROCESS);
        }
    }
}

#[cfg(not(windows))]
fn attach_console() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn dmabuf_is_turned_off_only_when_the_variable_is_unset() {
        assert!(should_disable_dmabuf(None));
        for value in ["1", "0", ""] {
            assert!(!should_disable_dmabuf(Some(value.as_ref())), "{value:?}");
        }
    }

    #[test]
    fn print_types_holds_every_binding_without_imports() {
        let out = types();
        for name in [
            "export type Entry",
            "export type FlowDoc",
            "export type ViewInfo",
            "export type Changed",
            "export interface View ",
            "export interface ViewContext",
            "export interface Blocks",
        ] {
            assert!(out.contains(name), "{name} missing");
        }
        assert!(!out.lines().any(|l| l.trim_start().starts_with("import ")));
    }

    /// A view imports its types from the bare `flow-cockpit`: the printed file declares that module, with every type
    /// inside it and no re-export line left.
    #[test]
    fn print_types_declares_the_flow_cockpit_module() {
        let out = types();
        let body = out
            .split_once("declare module 'flow-cockpit' {\n")
            .expect("no module declaration")
            .1;
        assert!(body.contains("export type Entry") && body.contains("export interface View "));
        assert!(body.trim_end().ends_with('}'));
        assert!(
            !out.lines()
                .any(|l| l.starts_with("export type * from") || l.starts_with("import ")),
            "an import or re-export is left"
        );
    }

    /// In the repository `flow-cockpit` resolves to `api.d.ts`, so it re-exports every binding.
    #[test]
    fn api_re_exports_every_binding() {
        for file in BINDINGS.files() {
            let name = file.path().file_stem().unwrap().to_str().unwrap();
            let line = format!("export type * from '../../bindings/{name}';");
            assert!(API.contains(&line), "api.d.ts lacks {line}");
        }
    }

    #[test]
    fn no_home_reads_no_folder() {
        let err = folders(|_| None, Platform::Linux).unwrap_err();
        assert_eq!(
            err.to_string(),
            "HOME is not set, so the flow cockpit can't find its folders"
        );
        let all_set = |key: &str| {
            ["CLAUDE_CONFIG_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"]
                .contains(&key)
                .then(|| format!("/{key}"))
        };
        let (home, config) = folders(all_set, Platform::Linux).unwrap();
        assert_eq!(
            home.claude_projects,
            Path::new("/CLAUDE_CONFIG_DIR/projects")
        );
        assert_eq!(config, Path::new("/XDG_CONFIG_HOME/flow-cockpit"));
    }

    #[test]
    fn print_paths_names_each_folder() {
        let found = Defaults {
            found: Some(PathBuf::from("/nix/store/x/share/flow-cockpit/extensions")),
            looked: vec![PathBuf::from(
                "/nix/store/x/bin/../share/flow-cockpit/extensions",
            )],
        };
        let config = PathBuf::from("/h/.config/flow-cockpit");
        assert_eq!(
            paths_text(&found, &config),
            format!(
                "default extensions: {}\nuser extensions: {}\nconfig: {}\n",
                Path::new("/nix/store/x/share/flow-cockpit/extensions").display(),
                config.join("extensions").display(),
                config.join("config.toml").display(),
            )
        );
        let missing = Defaults {
            found: None,
            looked: vec![PathBuf::from("/a"), PathBuf::from("/b")],
        };
        assert!(
            paths_text(&missing, &config)
                .starts_with("default extensions: none found (looked in /a, /b)\n")
        );
    }
}
