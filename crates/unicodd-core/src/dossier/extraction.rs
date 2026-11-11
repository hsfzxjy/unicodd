use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::{
    digest,
    paths::{self, PathTrace, Profile, Transform},
};

pub(super) const MAX_ENTRIES: usize = 40;
pub(super) const MAX_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(super) enum MemberType {
    File,
    Symlink,
    Hardlink,
    Directory,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Member {
    pub id: String,
    pub path: String,
    pub kind: MemberType,
    pub size: u64,
    pub payload: String,
    pub binding: Option<Binding>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct Binding {
    pub file: String,
    pub record: String,
    pub original: String,
    pub digest: String,
}

pub(super) struct EntryTrace {
    pub id: String,
    pub path: String,
    pub resolution: Option<PathTrace>,
    pub issue: Option<(&'static str, String)>,
}

pub(super) struct Restored {
    pub path: String,
    pub digest: String,
    pub id: String,
    pub bytes: Vec<u8>,
    pub binding: Option<Binding>,
}

pub(super) struct Extraction {
    pub tree: Option<BTreeMap<Vec<String>, Restored>>,
    pub rows: Vec<EntryTrace>,
    pub budget_issue: Option<&'static str>,
}

/// Construct an isolated virtual tree. Publish it only after validating every
/// member's type, length, namespace, and relationship to all other paths.
pub(super) fn extract(profile: Profile, transform: Transform, members: &[Member]) -> Extraction {
    if members.len() > MAX_ENTRIES
        || members
            .iter()
            .try_fold(0_u64, |total, member| total.checked_add(member.size))
            .is_none_or(|total| total > MAX_BYTES)
    {
        return Extraction {
            tree: None,
            rows: vec![],
            budget_issue: Some("archive-budget"),
        };
    }
    let mut traces = vec![];
    let mut ids = BTreeSet::new();
    let mut tree: BTreeMap<Vec<String>, Restored> = BTreeMap::new();
    let mut directories: BTreeMap<Vec<String>, (String, String)> = BTreeMap::new();
    for member in members {
        let mut trace = EntryTrace {
            id: member.id.clone(),
            path: member.path.clone(),
            resolution: None,
            issue: None,
        };
        let mut check = || {
            if !ids.insert(&member.id) {
                return Err(("duplicate-member", member.id.clone()));
            }
            if member.kind != MemberType::File {
                return Err(("member-type", "Only regular files are accepted.".into()));
            }
            if member.size != member.payload.len() as u64 {
                return Err((
                    "member-length",
                    format!("Declared {} · actual {}", member.size, member.payload.len()),
                ));
            }
            let resolved = paths::resolve(profile, &member.path, transform);
            trace.resolution = Some(resolved);
            let resolved = trace.resolution.as_ref().unwrap();
            if let Some(issue) = resolved.issue {
                return Err((issue, String::new()));
            }
            if let Some(previous) = tree.get(&resolved.key) {
                return Err(("path-collision", previous.id.clone()));
            }
            if let Some((_, previous)) = directories.get(&resolved.key) {
                return Err(("file-directory", previous.clone()));
            }
            for depth in 1..resolved.key.len() {
                let prefix = &resolved.key[..depth];
                if let Some(previous) = tree.get(prefix) {
                    return Err(("file-directory", previous.id.clone()));
                }
                if let Some((name, previous)) = directories.get(prefix) {
                    if name != &resolved.transformed[..depth].join("/") {
                        return Err(("directory-alias", previous.clone()));
                    }
                }
            }
            for depth in 1..resolved.key.len() {
                directories
                    .entry(resolved.key[..depth].to_vec())
                    .or_insert_with(|| {
                        (resolved.transformed[..depth].join("/"), member.id.clone())
                    });
            }
            let bytes = member.payload.as_bytes().to_vec();
            tree.insert(
                resolved.key.clone(),
                Restored {
                    path: resolved.relative(),
                    digest: digest(&bytes),
                    id: member.id.clone(),
                    bytes,
                    binding: member.binding.clone(),
                },
            );
            Ok(())
        };
        trace.issue = check().err();
        traces.push(trace);
    }
    Extraction {
        tree: traces
            .iter()
            .all(|trace| trace.issue.is_none())
            .then_some(tree),
        rows: traces,
        budget_issue: None,
    }
}
