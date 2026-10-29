//! The window's read-only commands. Each reads the shared index or the views folders and changes nothing; the
//! poll thread is the only writer of the index.
//!
//! The commands run off the main thread (`async`), so reading a large transcript for `session` never stalls the
//! window, and they share the index through a read lock.

// Tauri hands a command its `State` by value.
#![expect(clippy::needless_pass_by_value)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use flow_cockpit_core::activity::Activity;
use flow_cockpit_core::index::{DocName, Entry, FlowRun, Index, Project};
use tauri::State;

use crate::views::{ViewInfo, Views};

/// What the commands and the poll share.
pub struct Shared {
    index: RwLock<Index>,
    pub views: Views,
    /// Set by the first `entries` answer: the window has painted, and the poll may start the link scan.
    painted: AtomicBool,
}

impl Shared {
    #[must_use]
    pub fn new(index: Index, views: Views) -> Shared {
        Shared {
            index: RwLock::new(index),
            views,
            painted: AtomicBool::new(false),
        }
    }

    /// A panic in another holder leaves the index as it was last written, which is still worth showing.
    pub fn read(&self) -> RwLockReadGuard<'_, Index> {
        self.index.read().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn write(&self) -> RwLockWriteGuard<'_, Index> {
        self.index.write().unwrap_or_else(PoisonError::into_inner)
    }

    #[must_use]
    pub fn painted(&self) -> bool {
        self.painted.load(Ordering::Acquire)
    }

    /// The project's entries; the first answer lets the poll start the link scan.
    pub fn entries(&self, project: &str) -> Vec<Entry> {
        let entries = self.read().entries(project);
        self.painted.store(true, Ordering::Release);
        entries
    }
}

type Data<'a> = State<'a, Arc<Shared>>;

#[tauri::command(async)]
pub fn projects(data: Data<'_>) -> Vec<Project> {
    data.read().projects()
}

#[tauri::command(async)]
pub fn entries(data: Data<'_>, project: &str) -> Vec<Entry> {
    data.entries(project)
}

#[tauri::command(async)]
pub fn flow_run(data: Data<'_>, project: &str, slug: &str) -> Option<FlowRun> {
    data.read().flow_run(project, slug)
}

/// `name` is the binding's `DocName`: `"Flow"`, `"Spec"` or `"Plan"`.
#[tauri::command(async)]
pub fn doc(data: Data<'_>, project: &str, slug: &str, name: &str) -> Option<String> {
    let name = match name {
        "Flow" => DocName::Flow,
        "Spec" => DocName::Spec,
        "Plan" => DocName::Plan,
        _ => return None,
    };
    data.read().doc(project, slug, name)
}

#[tauri::command(async)]
pub fn session(data: Data<'_>, id: &str) -> Option<Activity> {
    data.read().session(id)
}

#[tauri::command(async)]
pub fn views(data: Data<'_>) -> Vec<ViewInfo> {
    data.views.list()
}

/// The view's code, types stripped; the error names the line.
#[tauri::command(async)]
pub fn view_source(data: Data<'_>, id: &str) -> Result<String, String> {
    data.views.source(id)
}
