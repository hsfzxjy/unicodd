use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{
    bad_input, case_fold, digest, normalize, option, skeleton, Archive, EngineError, Form,
    Ingestion, Mirror, Report,
};

mod tables {
    include!(concat!(env!("OUT_DIR"), "/unicode_identifiers.rs"));
}
use tables::*;

#[derive(Clone, Copy, Deserialize)]
enum Profile {
    #[serde(rename = "15.1", alias = "15.1.0")]
    Legacy,
    #[serde(rename = "18.0", alias = "18.0.0")]
    Modern,
}

impl Profile {
    fn name(self) -> &'static str {
        match self {
            Self::Legacy => "15.1.0",
            Self::Modern => "18.0.0",
        }
    }

    fn xid(self, scalar: char, first: bool) -> bool {
        let ranges = match (self, first) {
            (Self::Legacy, true) => XID_START_LEGACY,
            (Self::Legacy, false) => XID_CONTINUE_LEGACY,
            (Self::Modern, true) => XID_START_MODERN,
            (Self::Modern, false) => XID_CONTINUE_MODERN,
        };
        let point = scalar as u32;
        let index = ranges.partition_point(|range| range.1 < point);
        ranges.get(index).is_some_and(|range| range.0 <= point)
    }

    fn category(self, scalar: char) -> &'static str {
        let ranges = match self {
            Self::Legacy => CATEGORY_LEGACY,
            Self::Modern => CATEGORY_MODERN,
        };
        let point = scalar as u32;
        let index = ranges.partition_point(|range| range.1 < point);
        ranges
            .get(index)
            .filter(|range| range.0 <= point)
            .map_or("Cn", |range| range.2)
    }

    fn fold(self, label: &str) -> Result<String, EngineError> {
        match self {
            Self::Legacy => case_fold(label),
            Self::Modern => {
                let mut result = String::new();
                for scalar in label.chars() {
                    match CASE_FOLD_MODERN.binary_search_by_key(&scalar, |row| row.0) {
                        Ok(index) => result.push_str(CASE_FOLD_MODERN[index].1),
                        Err(_) => result.push(scalar),
                    }
                }
                Ok(result)
            }
        }
    }

    fn identifier(self, label: &str) -> bool {
        !label.is_empty()
            && label
                .chars()
                .enumerate()
                .all(|(index, scalar)| self.xid(scalar, index == 0))
    }
}

fn profile(text: &str, index: usize) -> Result<Profile, EngineError> {
    option(text, index, "15.1 or 18.0")
}

pub(super) fn inspect(version: &str, label: &str, report: &mut Report) -> Result<(), EngineError> {
    let profile = profile(version, 0)?;
    if label.chars().count() > 64 {
        return Err(bad_input("Inspect at most 64 Unicode scalars at once.", 1));
    }
    report.row(
        "Identifier profile",
        [profile.name(), "XID_Start followed by XID_Continue"],
    );
    report
        .row("Original UTF-8", [label, &hex(label.as_bytes())])
        .inspect
        .push(label.into());
    for scalar in label.chars() {
        let category = profile.category(scalar);
        report.row(
            format!("U+{:04X}", scalar as u32),
            [
                scalar.to_string(),
                category.into(),
                if category == "Cn" {
                    "unassigned"
                } else {
                    "assigned"
                }
                .into(),
                format!(
                    "XID_Start {} · XID_Continue {}",
                    profile.xid(scalar, true),
                    profile.xid(scalar, false)
                ),
            ],
        );
    }
    let key = profile.fold(label)?;
    report.row("Default full fold", [&key]).inspect.push(key);
    report.row(
        "Identifier",
        [if profile.identifier(label) {
            "Accepted"
        } else {
            "Rejected by the XID profile"
        }],
    );
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Independent {
    pub id: String,
    pub registration: String,
    pub owner: String,
    pub label: String,
    pub digest: String,
    pub verified: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Entry {
    pub id: String,
    registration: String,
    owner: String,
    raw_label: String,
    display_label: String,
    raw_digest: String,
    source_digest: String,
    pub handle: String,
    search_legacy: String,
    search_modern: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Storage {
    Opaque,
    Nfc,
    Ascii,
    Identifier,
    Authorization,
}

fn ascii_fallback(label: &str) -> String {
    label
        .chars()
        .map(|scalar| if scalar.is_ascii() { scalar } else { '_' })
        .collect()
}

fn explicit_handles(input: &str) -> Result<BTreeMap<&str, &str>, EngineError> {
    let mut handles = BTreeMap::new();
    for mapping in input.split(',') {
        let (id, handle) = mapping
            .split_once('=')
            .ok_or_else(|| bad_input("Supply map:ID=handle,ID=handle using every source ID.", 1))?;
        if id.is_empty() || handle.is_empty() || handles.insert(id, handle).is_some() {
            return Err(bad_input(
                "Each mapped source ID must appear once with a nonempty handle.",
                1,
            ));
        }
    }
    Ok(handles)
}

fn handles(
    policy: &str,
    records: &[Original<'_>],
    selected: Profile,
) -> Result<Vec<String>, EngineError> {
    let explicit = policy
        .strip_prefix("map:")
        .map(explicit_handles)
        .transpose()?;
    if explicit.as_ref().is_some_and(|map| {
        map.len() != records.len() || records.iter().any(|record| !map.contains_key(record.id))
    }) {
        return Err(bad_input("Map every authorized source ID exactly once.", 1));
    }
    records
        .iter()
        .map(|record| {
            Ok(match policy {
                "id" => record.id.replace('-', "_"),
                "suffix" => format!("R_{}", record.id.rsplit('-').next().unwrap_or(record.id)),
                "labels" => record.label.into(),
                "fold" => selected.fold(record.label)?,
                "nfkc" => normalize(record.label, Form::NFKC)?,
                "ascii" => ascii_fallback(record.label),
                "skeleton" => skeleton(record.label)?,
                other => {
                    if let Some(prefix) = other.strip_prefix("prefix:") {
                        format!("{prefix}{}", record.id.replace('-', "_"))
                    } else if let Some(map) = &explicit {
                        map[record.id].into()
                    } else {
                        return Err(bad_input("Choose a documented handle policy.", 1));
                    }
                }
            })
        })
        .collect()
}

struct Original<'a> {
    id: &'a str,
    registration: &'a str,
    owner: &'a str,
    label: &'a str,
    source_digest: &'a str,
}

pub(super) fn mirror(
    archive: &Archive,
    ingestion: &Ingestion,
    args: [&str; 3],
    committed: Option<&Mirror>,
    report: &mut Report,
) -> Result<Option<Mirror>, EngineError> {
    let [storage, policy, search_version] = args;
    let storage: Storage = option(
        storage,
        0,
        "opaque, nfc, ascii, identifier, or authorization",
    )?;
    let selected = profile(search_version, 2)?;
    let mut originals = Vec::new();
    for source in &ingestion.dispatch.release.outbox {
        let identity = ingestion
            .dispatch
            .release
            .identities
            .iter()
            .find(|identity| identity.approval.registration == source.registration)
            .expect("validated release");
        originals.push(Original {
            id: &source.archive_id,
            registration: &source.registration,
            owner: &source.owner,
            label: &identity.name,
            source_digest: &source.digest,
        });
    }
    originals.extend(archive.independent.iter().map(|source| Original {
        id: &source.id,
        registration: &source.registration,
        owner: &source.owner,
        label: &source.label,
        source_digest: &source.digest,
    }));
    let handles = handles(policy, &originals, selected)?;
    let mut entries = Vec::new();
    let mut exact = true;
    let mut label_context = true;
    let mut queryable = true;
    let mut references = BTreeMap::<String, String>::new();
    let mut unique = true;
    let mut stable = true;
    let mut legacy = BTreeMap::<String, Vec<String>>::new();
    let mut modern = BTreeMap::<String, Vec<String>>::new();
    for (original, handle) in originals.iter().zip(handles) {
        let stored = match storage {
            Storage::Opaque | Storage::Identifier | Storage::Authorization => original.label.into(),
            Storage::Nfc => normalize(original.label, Form::NFC)?,
            Storage::Ascii => ascii_fallback(original.label),
        };
        let raw_digest = digest(original.label.as_bytes());
        let search_legacy = Profile::Legacy.fold(original.label)?;
        let search_modern = Profile::Modern.fold(original.label)?;
        let candidate_legacy = Profile::Legacy.identifier(&handle);
        let candidate_modern = Profile::Modern.identifier(&handle);
        let legal_handle =
            candidate_legacy && candidate_modern && handle.len() <= 64 && handle.is_ascii();
        report
            .row(
                original.id,
                [
                    original.label,
                    &handle,
                    original.owner,
                    if candidate_legacy {
                        "Handle XID 15.1 ✓"
                    } else {
                        "Handle XID 15.1 rejected"
                    },
                    if candidate_modern {
                        "Handle XID 18.0 ✓"
                    } else {
                        "Handle XID 18.0 rejected"
                    },
                ],
            )
            .inspect
            .push(original.label.into());
        if !legal_handle {
            queryable = false;
            report.row(
                "Legacy reference rejected",
                [
                    original.id,
                    "The exchange requires a bounded ASCII XID handle.",
                ],
            );
        }
        if stored != original.label {
            exact = false;
            report.row(
                "Label changed",
                [original.id, &raw_digest, &digest(stored.as_bytes())],
            );
        }
        match storage {
            Storage::Identifier if !Profile::Legacy.identifier(&stored) => {
                label_context = false;
                report.row(
                    "Legacy label rejected",
                    [
                        original.id,
                        "The label is outside the legacy identifier repertoire.",
                    ],
                );
            }
            Storage::Authorization => {
                label_context = false;
                report.row(
                    "Authorization rejected",
                    [
                        original.id,
                        "An opaque label cannot select an owner or grant access.",
                    ],
                );
            }
            _ => {}
        }
        if let Some(previous) = references.insert(handle.to_ascii_lowercase(), original.id.into()) {
            unique = false;
            report.row("Handle collision", [&previous, original.id, &handle]);
        }
        if committed.is_some_and(|mirror| {
            !mirror
                .records
                .iter()
                .any(|entry| entry.id == original.id && entry.handle == handle)
        }) {
            stable = false;
            report.row("Existing handle would change", [original.id, &handle]);
        }
        legacy
            .entry(search_legacy.clone())
            .or_default()
            .push(original.id.into());
        modern
            .entry(search_modern.clone())
            .or_default()
            .push(original.id.into());
        entries.push(Entry {
            id: original.id.into(),
            registration: original.registration.into(),
            owner: original.owner.into(),
            raw_label: stored,
            display_label: super::super::escape_controls(original.label),
            raw_digest,
            source_digest: original.source_digest.into(),
            handle,
            search_legacy,
            search_modern,
        });
    }
    for (version, groups) in [(Profile::Legacy, &legacy), (Profile::Modern, &modern)] {
        for (key, ids) in groups.iter().filter(|(_, ids)| ids.len() > 1) {
            report.row(
                format!("{} search collision", version.name()),
                std::iter::once(key).chain(ids),
            );
        }
    }
    report.row(
        "Search index",
        [
            selected.name(),
            "Default full fold · multiple records per key",
        ],
    );
    report.check("original-bytes", exact);
    report.check(
        "opaque-labels",
        label_context && matches!(storage, Storage::Opaque),
    );
    report.check("legacy-queryable", queryable);
    report.check("unique-handles", unique);
    report.check("stable-handles", stable);
    Ok(report.solved.then(|| Mirror {
        ingestion: ingestion.clone(),
        records: entries,
        search_version: selected.name().into(),
        legacy_references: references,
        legacy_search: legacy,
        modern_search: modern,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_repertoire_and_case_folding() {
        assert_eq!(Profile::Legacy.category('\u{1C89}'), "Cn");
        assert_eq!(Profile::Legacy.category('\u{1C8A}'), "Cn");
        assert_eq!(Profile::Modern.category('\u{1C89}'), "Lu");
        assert_eq!(Profile::Modern.category('\u{1C8A}'), "Ll");
        assert!(!Profile::Legacy.identifier("Ᲊora"));
        assert!(Profile::Modern.identifier("Ᲊora"));
        assert!(Profile::Modern.identifier("ᲊora"));
        assert_eq!(Profile::Legacy.fold("Ᲊora").unwrap(), "Ᲊora");
        assert_eq!(Profile::Modern.fold("Ᲊora").unwrap(), "ᲊora");
        for profile in [Profile::Legacy, Profile::Modern] {
            assert!(profile.identifier("Cafe\u{301}"));
            assert!(!profile.identifier("\u{301}Cafe"));
            assert_ne!(profile.fold("Mira").unwrap(), profile.fold("Mіra").unwrap());
        }
    }
}
