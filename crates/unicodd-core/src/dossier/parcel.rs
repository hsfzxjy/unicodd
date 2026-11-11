use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{
    digest_json,
    extraction::{self, Binding, Extraction, Member, MemberType},
    identifier,
    paths::{self, PathTrace, Profile, Transform, TARGETS},
    publication::{self, Asset, Publication},
    Command, Dataset, Receipt, Report, Review,
};
use crate::{EngineError, ErrorCode};

pub(super) const CHECKS: &[&str] = &[
    "publication",
    "candidate",
    "archive",
    "portable-paths",
    "bindings",
    "disclosure",
];

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Sandbox {
    samples: BTreeMap<String, Vec<Sample>>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Sample {
    id: String,
    path: String,
    kind: MemberType,
    size: u64,
    payload: String,
}

impl Sandbox {
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.samples.len() > 24
            || self.samples.iter().any(|(id, entries)| {
                !identifier(id)
                    || entries.is_empty()
                    || entries.len() > extraction::MAX_ENTRIES + 4
                    || entries.iter().any(|entry| {
                        !identifier(&entry.id)
                            || entry.path.len() > paths::PATH_BUDGET + 16
                            || entry.payload.len() > 4096
                    })
            })
        {
            return Err(EngineError::new(
                ErrorCode::InvalidProgram,
                "Invalid sandbox fixture inventory.",
            ));
        }
        Ok(())
    }

    fn fixture(&self, name: &str) -> Option<Vec<Member>> {
        Some(
            self.samples
                .get(name)?
                .iter()
                .map(|sample| Member {
                    id: sample.id.clone(),
                    path: sample.path.clone(),
                    kind: sample.kind,
                    size: sample.size,
                    payload: sample.payload.clone(),
                    binding: None,
                })
                .collect(),
        )
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Mapping {
    source_file: String,
    public_record: String,
    original_name: String,
    path: String,
    digest: String,
}

struct Plan {
    members: Vec<Member>,
    manifest: Vec<Mapping>,
    transform: Transform,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    version: u32,
    publication: String,
    files: Vec<Mapping>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Archive {
    manifest: Manifest,
    members: Vec<Member>,
}

fn binding(asset: &Asset) -> Binding {
    Binding {
        file: asset.id.clone(),
        record: asset.record.clone(),
        original: asset.name.clone(),
        digest: asset.digest.clone(),
    }
}

impl Plan {
    fn from_assets(assets: &[Asset], mode: &str) -> Result<Self, &'static str> {
        let mut explicit = BTreeMap::new();
        let transform = Transform::parse(mode);
        let prefix = mode.strip_prefix("prefix:");
        if let Some(entries) = mode
            .strip_prefix("map:")
            .or_else(|| mode.strip_prefix("bind:"))
        {
            for entry in entries.split(',') {
                let (source, target) = entry.split_once('=').ok_or("Expected file ID = path.")?;
                let (payload, path) = if mode.starts_with("bind:") {
                    target
                        .split_once('@')
                        .ok_or("Expected payload ID @ path.")?
                } else {
                    (source, target)
                };
                if explicit.insert(source, (payload, path)).is_some() {
                    return Err("A source file ID was mapped more than once.");
                }
            }
            if explicit.len() != assets.len() {
                return Err("Map every approved source file ID exactly once.");
            }
        } else if transform.is_none() && prefix.is_none() && mode != "id" {
            return Err("Use a filename transform, stable handles or an explicit file map.");
        }
        let known: BTreeMap<_, _> = assets
            .iter()
            .map(|asset| (asset.id.as_str(), asset))
            .collect();
        let mut members = vec![];
        let mut manifest = vec![];
        for &expected in known.values() {
            let (payload, path) = if !explicit.is_empty() {
                let (id, path) = explicit
                    .get(expected.id.as_str())
                    .ok_or("At least one approved source file is missing from the map.")?;
                let payload = known
                    .get(id)
                    .ok_or("An input is outside the approved public inventory.")?;
                (*payload, (*path).to_owned())
            } else if let Some(prefix) = prefix {
                (expected, format!("{prefix}/{}.dat", expected.id))
            } else if mode == "id" {
                (expected, format!("{}.dat", expected.id))
            } else {
                (expected, expected.name.clone())
            };
            members.push(Member {
                id: expected.id.clone(),
                path: path.clone(),
                kind: MemberType::File,
                size: payload.payload.len() as u64,
                payload: payload.payload.clone(),
                binding: Some(binding(payload)),
            });
            manifest.push(Mapping {
                source_file: expected.id.clone(),
                public_record: expected.record.clone(),
                original_name: expected.name.clone(),
                path,
                digest: expected.digest.clone(),
            });
        }
        Ok(Self {
            members,
            manifest,
            transform: transform.unwrap_or(Transform::Raw),
        })
    }
}

fn hex(raw: &str) -> String {
    raw.bytes()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn path_row(report: &mut Report, label: &str, path: &str, trace: Option<&PathTrace>, full: bool) {
    let row = report.row(label, [path.into()]);
    if full {
        row.inspect.push(path.to_owned());
        row.details.push(format!("UTF-8 {}", hex(path)));
    }
    if let Some(trace) = trace {
        row.details.push(format!("Parsed {:?}", trace.components));
        row.details
            .push(format!("Transformed {:?}", trace.transformed));
        row.details.push(format!("Key {:?}", trace.key));
        if trace.issue.is_none() {
            row.details
                .push(format!("Resolved /drop/{}", trace.relative()));
        }
    }
}

fn show_extraction(report: &mut Report, profile: Profile, extraction: &Extraction) {
    report.row(profile.name(), [profile.comparison().into()]);
    for entry in &extraction.rows {
        if extraction.tree.is_none() || entry.issue.is_some() {
            path_row(
                report,
                &entry.id,
                &entry.path,
                entry.resolution.as_ref(),
                false,
            );
        }
        if let Some((reason, other)) = &entry.issue {
            report.row(*reason, [entry.id.clone(), other.clone()]);
        }
    }
    if let Some(issue) = extraction.budget_issue {
        report.row(
            issue,
            ["Member count or declared payload length exceeds the sandbox limit.".into()],
        );
    }
    if let Some(tree) = &extraction.tree {
        report.row("Staged virtual tree", [format!("{} files", tree.len())]);
        for placed in tree.values() {
            report.row(
                format!("/drop/{}", placed.path),
                [placed.id.clone(), placed.digest.clone()],
            );
        }
    } else {
        report.row("Extraction rejected", ["No files staged.".into()]);
    }
}

fn targets(report: &mut Report) {
    for profile in TARGETS {
        report.row(profile.name(), [profile.comparison().into()]);
    }
    report.row(
        "Sandbox",
        [format!(
            "{} entries · {} payload bytes · regular files",
            extraction::MAX_ENTRIES,
            extraction::MAX_BYTES
        )],
    );
}

fn probe(report: &mut Report, args: &[String]) {
    let (Some(profile), Some(transform)) = (Profile::parse(&args[0]), Transform::parse(&args[1]))
    else {
        report.reject(
            "profile",
            "Use a named target and raw, nfc, lower, nfkc or ascii.",
        );
        return;
    };
    let path = &args[2];
    let trace = paths::resolve(profile, path, transform);
    path_row(report, profile.name(), path, Some(&trace), true);
    if let Some(issue) = trace.issue {
        report.reject("path", issue);
    } else {
        report.check("path", true);
    }
}

fn show_assets(report: &mut Report, view: &Publication, id: &str) {
    let mut shown = false;
    for asset in &view.assets {
        if id == "all" || id == asset.id {
            shown = true;
            let row = report.row(
                &asset.id,
                [
                    asset.record.clone(),
                    asset.name.clone(),
                    asset.digest.clone(),
                ],
            );
            row.inspect.push(asset.name.clone());
            if id != "all" {
                let row = report.row("Public payload", [asset.payload.clone()]);
                row.serialized = Some(asset.payload.clone());
                row.copy_label = Some("Copy public payload");
            }
        }
    }
    if !shown {
        report.reject(
            "candidate",
            "Choose an ID from the approved public inventory.",
        );
    }
}

fn stage(report: &mut Report, args: Vec<String>, view: &Publication, sandbox: &Sandbox) {
    let [target, mapping] = &args[..] else {
        unreachable!()
    };
    let profiles = if target == "all" {
        TARGETS.to_vec()
    } else if let Some(profile) = Profile::parse(target) {
        vec![profile]
    } else {
        report.reject("candidate", "Choose a named target or all.");
        return;
    };
    let (members, transform) = if let Some(sample) = mapping.strip_prefix("sample:") {
        let Some(members) = sandbox.fixture(sample) else {
            report.reject("candidate", "Choose a named sandbox sample.");
            return;
        };
        report.row("Independent sandbox sample", [sample.into()]);
        (members, Transform::Raw)
    } else {
        let plan = match Plan::from_assets(&view.assets, mapping) {
            Ok(plan) => plan,
            Err(issue) => {
                report.reject("candidate", issue);
                return;
            }
        };
        (plan.members, plan.transform)
    };
    let mut passed = true;
    for profile in profiles {
        let extraction = extraction::extract(profile, transform, &members);
        passed &= extraction.tree.is_some();
        show_extraction(report, profile, &extraction);
    }
    report.check("archive", passed);
    report.candidate = Some(args);
}

fn portable(path: &str) -> bool {
    path.split('/').all(|component| {
        !component.is_empty()
            && component
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    })
}

fn encode_archive(plan: Plan, approval: String, report: &mut Report) -> Option<String> {
    let mut members = plan.members;
    let mut mappings = plan.manifest;
    let mut valid = true;
    for (member, mapping) in members.iter_mut().zip(&mut mappings) {
        let resolved = paths::resolve(Profile::Posix, &member.path, plan.transform);
        if let Some(issue) = resolved.issue {
            path_row(report, &member.id, &member.path, Some(&resolved), false);
            report.row(issue, [member.id.clone()]);
            valid = false;
        } else {
            member.path = resolved.relative();
            mapping.path = member.path.clone();
        }
    }
    if !valid {
        report.reject(
            "archive",
            "A member path failed preflight. No virtual archive was written.",
        );
        return None;
    }
    let archive = Archive {
        manifest: Manifest {
            version: 1,
            publication: approval,
            files: mappings,
        },
        members,
    };
    Some(serde_json::to_string(&archive).expect("typed archive serializes"))
}

fn roundtrip(
    policy: &publication::Policy,
    view: &Publication,
    report: &mut Report,
    mut receipt: Receipt,
) {
    let args = report.candidate.clone().unwrap_or_default();
    let [target, mapping] = args.as_slice() else {
        report.reject(
            "candidate",
            "Stage an extraction of the approved public inventory first.",
        );
        return;
    };
    if target != "all" && Profile::parse(target).is_none() {
        report.reject("candidate", "The staged target is unavailable.");
        return;
    }
    let plan = match Plan::from_assets(&view.assets, mapping) {
        Ok(plan) => plan,
        Err(issue) => {
            report.reject("candidate", issue);
            return;
        }
    };
    let approval = view.approval(policy);
    let Some(bytes) = encode_archive(plan, approval.clone(), report) else {
        return;
    };
    let archive: Archive = serde_json::from_str(&bytes).expect("the encoded archive round-trips");
    let manifest = &archive.manifest;
    let mut trees = BTreeMap::new();
    let mut archive_ok = true;
    let mut binding_ok = manifest.version == 1 && manifest.publication == approval;
    let mut portable_ok = true;
    let mut disclosure_ok = true;
    for profile in TARGETS {
        let restored = extraction::extract(profile, Transform::Raw, &archive.members);
        if let Some(tree) = restored.tree {
            let mut verified = 0;
            binding_ok &=
                tree.len() == view.assets.len() && manifest.files.len() == view.assets.len();
            for mapping in &manifest.files {
                let key = paths::resolve(profile, &mapping.path, Transform::Raw).key;
                let Some(placed) = tree.get(&key) else {
                    binding_ok = false;
                    continue;
                };
                if !portable(&placed.path) {
                    portable_ok = false;
                    report.row("Storage path", [profile.name().into(), mapping.source_file.clone(), "Use a bounded ASCII storage handle and keep original names in the manifest.".into()]);
                }
                if publication::contains_protected_name(policy, &placed.path) {
                    disclosure_ok = false;
                    report.row(
                        "Disclosure",
                        [
                            profile.name().into(),
                            mapping.source_file.clone(),
                            "Storage path contains a protected source association.".into(),
                        ],
                    );
                }
                let expected = view
                    .assets
                    .iter()
                    .find(|asset| asset.id == mapping.source_file)
                    .unwrap();
                if placed.binding.as_ref() != Some(&binding(expected))
                    || placed.bytes != expected.payload.as_bytes()
                    || placed.id != mapping.source_file
                    || placed.path != mapping.path
                    || mapping.public_record != expected.record
                    || mapping.original_name != expected.name
                    || placed.digest != mapping.digest
                    || mapping.digest != expected.digest
                {
                    binding_ok = false;
                    report.row("Source binding", [profile.name().into(), mapping.source_file.clone(), "Restored asset or exact public payload does not match its source file.".into()]);
                } else {
                    verified += 1;
                }
            }
            report.row(
                profile.name(),
                [format!(
                    "{verified}/{} source files read back",
                    view.assets.len()
                )],
            );
            trees.insert(
                profile.name(),
                tree.into_iter()
                    .map(|(key, placed)| (key, placed.path, placed.id, placed.digest))
                    .collect::<Vec<_>>(),
            );
        } else {
            archive_ok = false;
            show_extraction(report, profile, &restored);
        }
    }
    report.check("archive", archive_ok);
    report.check("portable-paths", portable_ok);
    report.check("bindings", binding_ok);
    report.check("disclosure", disclosure_ok);
    if !report.solved {
        return;
    }
    let archive_digest = super::digest(bytes.as_bytes());
    let bundle = digest_json(&(&archive_digest, &trees));
    report.row(
        "Delivery verified",
        [
            format!("{} files on {} targets", manifest.files.len(), trees.len()),
            bundle.clone(),
        ],
    );
    for file in &manifest.files {
        report.row(
            &file.source_file,
            [
                file.public_record.clone(),
                file.path.clone(),
                file.original_name.clone(),
                file.digest.clone(),
            ],
        );
    }
    let row = report.row("Bundle manifest", [manifest.publication.clone()]);
    row.serialized =
        Some(serde_json::to_string_pretty(manifest).expect("typed bundle manifest serializes"));
    row.copy_label = Some("Copy bundle manifest");
    let row = report.row("Virtual archive", [archive_digest]);
    row.serialized = Some(bytes);
    row.copy_label = Some("Copy virtual archive");
    receipt.bundle = Some(Review {
        args,
        digest: digest_json(&(receipt.publication.as_ref().unwrap(), bundle)),
    });
    report.handoff = Some(receipt);
}

pub(super) fn run(
    dataset: &Dataset,
    command: Command,
    args: Vec<String>,
    report: &mut Report,
    prior: Option<&Receipt>,
    snapshot: &str,
) -> Result<(), EngineError> {
    match command {
        Command::Targets => {
            targets(report);
            return Ok(());
        }
        Command::ProbePath => {
            probe(report, &args);
            return Ok(());
        }
        _ => {}
    }
    let (Some(policy), Some(sandbox)) = (&dataset.publication, &dataset.parcel) else {
        return Err(EngineError::new(
            ErrorCode::InvalidProgram,
            "This snapshot does not define a parcel inventory.",
        ));
    };
    if command == Command::Extract {
        report.candidate = None;
    }
    let Some((receipt, view)) = publication::approved(dataset, policy, prior, snapshot)? else {
        report.reject(
            "publication",
            "Read the approved publication before opening the delivery inventory.",
        );
        return Ok(());
    };
    match command {
        Command::Assets => show_assets(report, &view, &args[0]),
        Command::Extract => stage(report, args, &view, sandbox),
        Command::Roundtrip => roundtrip(policy, &view, report, receipt),
        _ => unreachable!(),
    }
    Ok(())
}
