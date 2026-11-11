mod extraction;
mod json;
mod parcel;
mod paths;
mod publication;
mod search;
mod spans;

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{EngineError, ErrorCode};

const VERSION: u32 = 1;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Dataset {
    version: u32,
    revision: String,
    query: String,
    approved_fields: Vec<String>,
    records: Vec<Record>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    publication: Option<publication::Policy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parcel: Option<parcel::Sandbox>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    id: String,
    eligible: bool,
    fields: BTreeMap<String, String>,
}

pub fn validate(dataset: &Dataset) -> Result<String, EngineError> {
    let fields = dataset.approved_fields.iter().collect::<BTreeSet<_>>();
    let ids = dataset
        .records
        .iter()
        .map(|record| &record.id)
        .collect::<BTreeSet<_>>();
    if dataset.version != VERSION
        || dataset.revision.is_empty()
        || dataset.query.is_empty()
        || dataset.query.len() > 128
        || fields.is_empty()
        || fields.len() != dataset.approved_fields.len()
        || dataset.records.is_empty()
        || dataset.records.len() > 32
        || ids.len() != dataset.records.len()
        || !dataset.records.iter().any(|record| record.eligible)
        || dataset.records.iter().any(|record| {
            !identifier(&record.id)
                || !fields
                    .iter()
                    .all(|field| record.fields.contains_key(*field))
                || record.fields.len() > 8
                || record.fields.values().any(|text| text.len() > 2048)
        })
    {
        return Err(EngineError::new(
            ErrorCode::InvalidProgram,
            "Invalid archive snapshot.",
        ));
    }
    let official = search::official(dataset)?;
    if !search::matches_ledger(dataset, &official) {
        return Err(EngineError::new(
            ErrorCode::InvalidProgram,
            "Archive field matches and the eligibility ledger disagree.",
        ));
    }
    if let Some(policy) = &dataset.publication {
        publication::validate(dataset, policy)?;
    }
    if let Some(sandbox) = &dataset.parcel {
        sandbox.validate()?;
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Catalog<'a> {
        version: u32,
        revision: &'a str,
        query: &'a str,
        approved_fields: &'a [String],
        records: &'a [Record],
    }
    // Keep the catalog seal stable when a downstream policy is added.
    Ok(digest_json(&Catalog {
        version: dataset.version,
        revision: &dataset.revision,
        query: &dataset.query,
        approved_fields: &dataset.approved_fields,
        records: &dataset.records,
    }))
}

fn identifier(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn digest_json(value: &impl Serialize) -> String {
    digest(&serde_json::to_vec(value).expect("typed dossier data serializes"))
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum Command {
    Search,
    Tokens,
    Select,
    Source,
    MapSpan,
    JsonCheck,
    Redact,
    Surfaces,
    Audit,
    Targets,
    ProbePath,
    Assets,
    Extract,
    Roundtrip,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    version: u32,
    snapshot: String,
    selection: Vec<String>,
    digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    publication: Option<Review>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bundle: Option<Review>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Review {
    args: Vec<String>,
    digest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    version: u32,
    dataset: Dataset,
    command: Command,
    args: Vec<String>,
    candidate: Option<Vec<String>>,
    prior: Option<Receipt>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    solved: bool,
    checks: Vec<Check>,
    declared_checks: &'static [&'static str],
    rows: Vec<Row>,
    candidate: Option<Vec<String>>,
    handoff: Option<Receipt>,
}

#[derive(Serialize)]
struct Check {
    id: &'static str,
    passed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    label: String,
    fields: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    details: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    inspect: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    serialized: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    copy_label: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<Source>,
}

#[derive(Serialize)]
struct Source {
    before: String,
    hit: String,
    after: String,
    coordinates: spans::Coordinates,
}

impl Report {
    fn row(
        &mut self,
        label: impl Into<String>,
        fields: impl IntoIterator<Item = String>,
    ) -> &mut Row {
        self.rows.push(Row {
            label: label.into(),
            fields: fields.into_iter().collect(),
            details: vec![],
            inspect: vec![],
            serialized: None,
            copy_label: None,
            source: None,
        });
        self.rows.last_mut().unwrap()
    }

    fn check(&mut self, id: &'static str, passed: bool) -> bool {
        debug_assert!(self.declared_checks.contains(&id));
        self.solved &= passed;
        self.checks.push(Check { id, passed });
        passed
    }

    fn reject(&mut self, id: &'static str, detail: impl Into<String>) {
        self.check(id, false);
        self.row("Review", [detail.into()]);
    }
}

pub fn run(request: Request) -> Result<Report, EngineError> {
    let Request {
        version,
        dataset,
        command,
        args,
        candidate,
        prior,
    } = request;
    let (arity, checks): (usize, &[_]) = match command {
        Command::Search => (3, &["profile"]),
        Command::Tokens => (3, &["profile"]),
        Command::Select => (0, &["candidate", "record-set", "source-spans"]),
        Command::Source => (2, &["selection", "source"]),
        Command::MapSpan => (3, &["selection", "source"]),
        Command::JsonCheck => (1, &["json"]),
        Command::Redact => (3, &["selection", "candidate"]),
        Command::Surfaces => (1, &["selection", "candidate", "surface"]),
        Command::Audit => (0, publication::CHECKS),
        Command::Targets => (0, &[]),
        Command::ProbePath => (3, &["profile", "path"]),
        Command::Assets => (1, &["publication", "candidate"]),
        Command::Extract => (2, &["publication", "candidate", "archive"]),
        Command::Roundtrip => (0, parcel::CHECKS),
    };
    if version != VERSION || args.len() != arity || args.iter().any(|arg| arg.len() > 2048) {
        return Err(EngineError::new(
            ErrorCode::InvalidInput,
            "Unsupported dossier request.",
        ));
    }
    let snapshot = validate(&dataset)?;
    let mut report = Report {
        solved: true,
        checks: vec![],
        declared_checks: checks,
        rows: vec![],
        candidate,
        handoff: None,
    };
    match command {
        Command::Search => search::stage(&dataset, &mut report, args),
        Command::Tokens => search::tokens(&dataset, &mut report, &args),
        Command::Select => search::select(&dataset, &mut report, snapshot),
        Command::JsonCheck => {
            publication::check_json(dataset.publication.as_ref(), &mut report, &args[0]);
            Ok(())
        }
        Command::Targets
        | Command::ProbePath
        | Command::Assets
        | Command::Extract
        | Command::Roundtrip => parcel::run(
            &dataset,
            command,
            args,
            &mut report,
            prior.as_ref(),
            &snapshot,
        ),
        _ => {
            let policy = dataset.publication.as_ref().ok_or_else(|| {
                EngineError::new(
                    ErrorCode::InvalidProgram,
                    "This snapshot does not define a publication policy.",
                )
            })?;
            let prior = prior.as_ref();
            match command {
                Command::Source => {
                    publication::inspect(&dataset, policy, &mut report, &args, prior, &snapshot)
                }
                Command::MapSpan => {
                    publication::map_span(&dataset, policy, &mut report, &args, prior, &snapshot)
                }
                Command::Redact => {
                    publication::stage(&dataset, policy, &mut report, args, prior, &snapshot)
                }
                Command::Surfaces => {
                    publication::surfaces(&dataset, policy, &mut report, &args[0], prior, &snapshot)
                }
                Command::Audit => {
                    publication::audit(&dataset, policy, &mut report, prior, &snapshot)
                }
                _ => unreachable!(),
            }
        }
    }?;
    Ok(report)
}
