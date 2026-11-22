use std::{
    collections::{BTreeMap, BTreeSet},
    ops::Range,
};

use serde::{Deserialize, Serialize};

use super::{
    digest, digest_json, identifier,
    json::{self, JsonString},
    search,
    spans::{coordinates, transform, Case, Normalization},
    Dataset, Receipt, Report, Review,
};
use crate::{EngineError, ErrorCode};

pub(super) const CHECKS: &[&str] = &[
    "selection",
    "candidate",
    "source-immutable",
    "protected-range",
    "technical-evidence",
    "json",
    "index",
    "metadata",
    "filenames",
    "manifest",
    "log",
];
const SOURCE_FIELDS: &[&str] = &[
    "title", "body", "sample", "contact", "email", "filename", "owner",
];

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Policy {
    version: String,
    literal_contact: String,
    marker: String,
    documents: Vec<Document>,
    json_samples: BTreeMap<String, String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    record: String,
    json: String,
    contact_bytes: [usize; 2],
    assets: Vec<AssetRule>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AssetRule {
    id: String,
    name: String,
    part: Part,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Part {
    Body,
    Sample,
    Record,
    Index,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct PublicRecord {
    id: String,
    title: String,
    body: String,
    sample: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct Asset {
    pub id: String,
    pub record: String,
    pub name: String,
    pub payload: String,
    pub digest: String,
}

#[derive(Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct Publication {
    records: Vec<PublicRecord>,
    pub assets: Vec<Asset>,
    json: String,
    index: BTreeMap<String, Vec<String>>,
    metadata: String,
    filenames: Vec<String>,
    manifest: String,
    log: Vec<String>,
}

impl Publication {
    pub fn approval(&self, policy: &Policy) -> String {
        digest_json(&(&policy.version, self))
    }

    fn seal(&self, policy: &Policy, selection: &str) -> String {
        digest_json(&(policy, selection, self.approval(policy)))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Pipeline {
    Fresh,
    Preview,
    Cache,
    SourceJson,
    PrivateName,
    PrivateDigest,
    SourceLog,
    DoubleEncode,
}

enum Selector<'a> {
    Ledger,
    Literal,
    Fold,
    UnitsAsBytes,
    EditSource,
    Explicit(BTreeMap<&'a str, Range<usize>>),
}

struct Options<'a> {
    selector: Selector<'a>,
    marker: &'a str,
    pipeline: Pipeline,
}

struct Finding {
    check: &'static str,
    text: String,
}

fn fields(document: &Document) -> BTreeMap<String, JsonString> {
    // Dataset validation precedes every operation.
    json::parse(&document.json).expect("validated disclosure source")
}

fn key(text: &str) -> String {
    transform(text, Normalization::Nfc, Case::Fold)
        .expect("bounded text")
        .text
}

pub(super) fn contains_protected_name(policy: &Policy, text: &str) -> bool {
    let folded = key(text);
    policy.documents.iter().any(|document| {
        let source = fields(document);
        ["contact", "email", "filename", "owner"]
            .iter()
            .any(|name| folded.contains(&key(&source[*name].value)))
    })
}

fn span(document: &Document) -> Range<usize> {
    document.contact_bytes[0]..document.contact_bytes[1]
}

pub(super) fn validate(dataset: &Dataset, policy: &Policy) -> Result<(), EngineError> {
    let invalid = |message| EngineError::new(ErrorCode::InvalidProgram, message);
    let eligible: BTreeSet<_> = dataset
        .records
        .iter()
        .filter(|record| record.eligible)
        .map(|record| record.id.as_str())
        .collect();
    let mut ids = BTreeSet::new();
    let mut records = BTreeSet::new();
    if !identifier(&policy.version)
        || policy.marker.is_empty()
        || policy.marker.len() > 64
        || policy.literal_contact.is_empty()
        || policy.literal_contact.len() > 128
        || policy.json_samples.len() > 16
        || policy.json_samples.values().any(|value| value.len() > 2048)
    {
        return Err(invalid("Invalid publication policy."));
    }
    for document in &policy.documents {
        if !records.insert(document.record.as_str())
            || !eligible.contains(document.record.as_str())
            || document.json.len() > 4096
            || document.assets.is_empty()
            || document.assets.len() > 16
        {
            return Err(invalid("Invalid publication source or asset count."));
        }
        let parsed =
            json::parse(&document.json).map_err(|_| invalid("Invalid source JSON interchange."))?;
        if parsed.len() != SOURCE_FIELDS.len()
            || SOURCE_FIELDS
                .iter()
                .any(|field| !parsed.contains_key(*field))
        {
            return Err(invalid("Incomplete source JSON object."));
        }
        let archive = dataset
            .records
            .iter()
            .find(|record| record.id == document.record)
            .unwrap();
        let body = &parsed["body"].value;
        let private = span(document);
        if body
            .get(private.clone())
            .is_none_or(|text| text.is_empty() || key(text) != key(&parsed["contact"].value))
            || !coordinates(body, private.clone()).exact_graphemes
            || parsed["body"].raw_span(private.clone()).is_none()
            || archive.fields.get("title") != Some(&parsed["title"].value)
            || archive
                .fields
                .get("body")
                .is_none_or(|value| !body.starts_with(value) || private.start < value.len())
            || ["contact", "email", "filename", "owner"]
                .iter()
                .any(|field| parsed[*field].value.is_empty())
        {
            return Err(invalid(
                "Disclosure source is out of scope or its protected range is invalid.",
            ));
        }
        for asset in &document.assets {
            if !identifier(&asset.id)
                || !ids.insert(&asset.id)
                || asset.name.is_empty()
                || asset.name.len() > 240
                || asset.name.chars().any(char::is_control)
            {
                return Err(invalid("Invalid approved file identity or original name."));
            }
        }
    }
    if records != eligible || ids.len() > 40 {
        return Err(invalid(
            "Publication inventory differs from the signed ledger.",
        ));
    }
    if policy
        .documents
        .iter()
        .flat_map(|document| &document.assets)
        .any(|asset| {
            contains_protected_name(policy, &asset.name)
                || contains_protected_name(policy, &asset.id)
        })
        || policy
            .documents
            .iter()
            .any(|document| contains_protected_name(policy, &document.record))
        || contains_protected_name(policy, &policy.version)
    {
        return Err(invalid(
            "Public names and references must be free of private source associations.",
        ));
    }
    Ok(())
}

fn options<'a>(policy: &'a Policy, args: &'a [String]) -> Option<Options<'a>> {
    let [selector, form, pipeline] = args else {
        return None;
    };
    let selector = match selector.as_str() {
        "ledger" => Selector::Ledger,
        "literal" => Selector::Literal,
        "fold" => Selector::Fold,
        "units-as-bytes" => Selector::UnitsAsBytes,
        "edit-source" => Selector::EditSource,
        value => {
            let mut ranges = BTreeMap::new();
            for entry in value.strip_prefix("bytes:")?.split(',') {
                let (id, range) = entry.split_once('=')?;
                if !policy
                    .documents
                    .iter()
                    .any(|document| document.record == id)
                {
                    return None;
                }
                if ranges.insert(id, parse_range(range)?).is_some() {
                    return None;
                }
            }
            Selector::Explicit(ranges)
        }
    };
    Some(Options {
        selector,
        marker: match form.as_str() {
            "omit" => "",
            "marker" => &policy.marker,
            _ => return None,
        },
        pipeline: match pipeline.as_str() {
            "fresh" => Pipeline::Fresh,
            "preview" => Pipeline::Preview,
            "cache" => Pipeline::Cache,
            "source-json" => Pipeline::SourceJson,
            "source-name" => Pipeline::PrivateName,
            "source-digest" => Pipeline::PrivateDigest,
            "source-log" => Pipeline::SourceLog,
            "double-encode" => Pipeline::DoubleEncode,
            _ => return None,
        },
    })
}

fn parse_range(text: &str) -> Option<Range<usize>> {
    let (start, end) = text.split_once('-')?;
    let (start, end) = (start.parse().ok()?, end.parse().ok()?);
    (start < end).then_some(start..end)
}

fn original(
    dataset: &Dataset,
    prior: Option<&Receipt>,
    snapshot: &str,
) -> Result<Option<Receipt>, EngineError> {
    let Some(prior) =
        prior.filter(|receipt| receipt.snapshot == snapshot && receipt.publication.is_none())
    else {
        return Ok(None);
    };
    let selected = search::verify(dataset, &prior.selection, snapshot)?;
    Ok(selected
        .ok()
        .map(|(receipt, _)| receipt)
        .filter(|receipt| receipt == prior))
}

fn splice(text: &str, ranges: &[Range<usize>], marker: &str) -> String {
    let mut projected = String::new();
    let mut cursor = 0;
    for range in ranges {
        projected.push_str(&text[cursor..range.start]);
        projected.push_str(marker);
        cursor = range.end;
    }
    projected.push_str(&text[cursor..]);
    projected
}

fn matching(text: &str, token: &str, fold: bool) -> Vec<Range<usize>> {
    if !fold {
        return text
            .match_indices(token)
            .map(|(index, value)| index..index + value.len())
            .collect();
    }
    let mapped = transform(text, Normalization::Nfc, Case::Fold).expect("bounded text");
    let mut covers: Vec<_> = mapped
        .text
        .match_indices(&key(token))
        .filter_map(|(index, value)| mapped.cover(index..index + value.len()))
        .collect();
    covers.sort_by_key(|span| span.start);
    let mut ranges: Vec<Range<usize>> = vec![];
    for span in covers {
        // Marks and folding expansions can produce overlapping covers.
        if let Some(last) = ranges.last_mut().filter(|last| span.start < last.end) {
            last.end = last.end.max(span.end);
        } else {
            ranges.push(span);
        }
    }
    ranges
}

fn json_text(value: &impl Serialize) -> String {
    serde_json::to_string(value).expect("typed publication data serializes")
}

fn build(policy: &Policy, options: &Options<'_>) -> (Publication, Vec<Finding>) {
    let mut findings = vec![];
    let mut records = vec![];
    let mut assets = vec![];
    let mut index = BTreeMap::new();
    let mut metadata = vec![];
    let mut filenames = vec![];
    let mut manifest = vec![];
    let mut log = vec![];
    let mut json = vec![];
    for document in &policy.documents {
        let source = fields(document);
        let id = &document.record;
        let body = &source["body"].value;
        let sample = &source["sample"].value;
        let expected = span(document);
        let mut ranges = match &options.selector {
            Selector::Ledger | Selector::EditSource => vec![expected.clone()],
            Selector::Explicit(ranges) => ranges.get(id.as_str()).cloned().into_iter().collect(),
            Selector::Literal | Selector::Fold => matching(
                body,
                &policy.literal_contact,
                matches!(options.selector, Selector::Fold),
            ),
            Selector::UnitsAsBytes => {
                let [start, end] = coordinates(body, expected.clone()).utf16;
                vec![start..end]
            }
        };
        let mut note = |check, detail: &str| {
            findings.push(Finding {
                check,
                text: format!("{id} · {detail}"),
            })
        };
        if ranges.iter().any(|range| body.get(range.clone()).is_none()) {
            note(
                "protected-range",
                "a selected byte edge cuts a source scalar",
            );
            ranges.clear();
        }
        if ranges.as_slice() != std::slice::from_ref(&expected) {
            note(
                "protected-range",
                "body · staff-contact range is incomplete or selects unrelated text",
            );
        }
        let record = PublicRecord {
            id: id.clone(),
            title: source["title"].value.clone(),
            body: splice(body, &ranges, options.marker),
            sample: match options.selector {
                Selector::Literal | Selector::Fold => splice(
                    sample,
                    &matching(
                        sample,
                        &policy.literal_contact,
                        matches!(options.selector, Selector::Fold),
                    ),
                    options.marker,
                ),
                _ => sample.clone(),
            },
        };
        let intended_body = splice(body, &[expected], options.marker);
        if record.body != intended_body || record.sample != *sample {
            note(
                "technical-evidence",
                "body or public sample differs from the approved source projection",
            );
        }
        // The legacy in-place mode changes the working source copy. Compare it
        // with the sealed original even when its visible preview is correct.
        let original_digest = digest(document.json.as_bytes());
        let working_source = if matches!(options.selector, Selector::EditSource) {
            let mut modified = source
                .iter()
                .map(|(name, field)| (name.as_str(), field.value.as_str()))
                .collect::<BTreeMap<_, _>>();
            modified.insert("body", &record.body);
            json_text(&modified)
        } else {
            document.json.clone()
        };
        if digest(working_source.as_bytes()) != original_digest {
            note(
                "source-immutable",
                "the working source differs from the sealed JSON bytes",
            );
        }

        let record_json = match options.pipeline {
            Pipeline::Preview | Pipeline::SourceJson => document.json.clone(),
            Pipeline::DoubleEncode => json_text(&json_text(&record)),
            _ => json_text(&record),
        };
        if serde_json::from_str::<PublicRecord>(&record_json)
            .ok()
            .as_ref()
            != Some(&record)
        {
            note(
                "json",
                "serialized record · wrong interchange shape or private source fields",
            );
        }
        let fresh_index = index_terms(&record.body);
        let terms = if matches!(options.pipeline, Pipeline::Preview | Pipeline::Cache) {
            index_terms(body)
        } else {
            fresh_index.clone()
        };
        if terms != fresh_index {
            note(
                "index",
                "search index and snippets still reference the protected source body",
            );
        }
        for rule in &document.assets {
            let name = if matches!(options.pipeline, Pipeline::Preview | Pipeline::PrivateName) {
                source["filename"].value.clone()
            } else {
                rule.name.clone()
            };
            let payload = match rule.part {
                Part::Body => record.body.clone(),
                Part::Sample => record.sample.clone(),
                Part::Record => record_json.clone(),
                Part::Index => json_text(&terms),
            };
            let asset = Asset {
                id: rule.id.clone(),
                record: id.clone(),
                name: name.clone(),
                digest: digest(payload.as_bytes()),
                payload,
            };
            if name != rule.name {
                note(
                    "filenames",
                    &format!(
                        "{} · export filename · private contact association",
                        asset.id
                    ),
                );
            }
            let manifest_digest = if options.pipeline == Pipeline::PrivateDigest {
                &original_digest
            } else {
                &asset.digest
            };
            if manifest_digest != &asset.digest {
                note(
                    "manifest",
                    &format!(
                        "{} · published digest refers to the protected original",
                        asset.id
                    ),
                );
            }
            manifest.push(json_text(&(
                &asset.id,
                &asset.record,
                &asset.name,
                manifest_digest,
            )));
            filenames.push(name);
            assets.push(asset);
        }
        let owner = if options.pipeline == Pipeline::Preview {
            Some(source["owner"].value.as_str())
        } else {
            None
        };
        if owner.is_some() {
            note("metadata", "record metadata · private owner reference");
        }
        metadata.push(json_text(&(id, &record.title, &policy.version, owner)));
        if options.pipeline == Pipeline::SourceLog {
            note("log", "export log includes the private contact annotation");
            log.push(format!("{id} · {}", source["email"].value));
        } else {
            log.push(format!("{id} · projection built"));
        }
        index.insert(id.clone(), terms);
        json.push(record_json);
        records.push(record);
    }
    (
        Publication {
            records,
            assets,
            json: format!("[{}]", json.join(",")),
            index,
            metadata: format!("[{}]", metadata.join(",")),
            filenames,
            manifest: format!("[{}]", manifest.join(",")),
            log,
        },
        findings,
    )
}

fn index_terms(body: &str) -> Vec<String> {
    use unicode_segmentation::UnicodeSegmentation;
    body.lines()
        .flat_map(|line| {
            let terms = line.unicode_words().map(key).collect::<Vec<_>>();
            [terms.join(" "), line.to_owned()]
        })
        .collect()
}

fn review_rows(report: &mut Report, view: &Publication) {
    for record in &view.records {
        report.row(&record.id, [record.title.clone()]);
        report.row("Body", [record.body.clone()]);
        report.row("Public sample", [record.sample.clone()]);
    }
}

pub(super) fn stage(
    dataset: &Dataset,
    policy: &Policy,
    report: &mut Report,
    args: Vec<String>,
    prior: Option<&Receipt>,
    snapshot: &str,
) -> Result<(), EngineError> {
    report.candidate = None;
    if original(dataset, prior, snapshot)?.is_none() {
        report.reject(
            "selection",
            "Read the verified catalog selection before staging a publication.",
        );
        return Ok(());
    }
    let Some(options) = options(policy, &args) else {
        report.reject("candidate", "Use a span selector, a replacement form, and an export pipeline from the review tools.");
        return Ok(());
    };
    let (view, _) = build(policy, &options);
    report.row(
        "Candidate body preview",
        ["Use audit to check all export surfaces.".into()],
    );
    review_rows(report, &view);
    report.candidate = Some(args);
    Ok(())
}

pub(super) fn audit(
    dataset: &Dataset,
    policy: &Policy,
    report: &mut Report,
    prior: Option<&Receipt>,
    snapshot: &str,
) -> Result<(), EngineError> {
    let Some(mut receipt) = original(dataset, prior, snapshot)? else {
        report.reject(
            "selection",
            "Read the verified catalog selection before approving a publication.",
        );
        return Ok(());
    };
    let args = report.candidate.clone().unwrap_or_default();
    let Some(options) = options(policy, &args) else {
        report.reject(
            "candidate",
            "Stage a release candidate before running the audit.",
        );
        return Ok(());
    };
    let (view, findings) = build(policy, &options);
    for &check in &CHECKS[2..] {
        report.check(check, findings.iter().all(|finding| finding.check != check));
    }
    for finding in findings {
        report.row(finding.check, [finding.text]);
    }
    if report.solved {
        let approval = view.approval(policy);
        report.row(
            "Public release approved",
            [
                format!(
                    "{} records · {} assets",
                    view.records.len(),
                    view.assets.len()
                ),
                approval.clone(),
            ],
        );
        for asset in &view.assets {
            report.row(
                &asset.id,
                [
                    asset.record.clone(),
                    asset.name.clone(),
                    asset.digest.clone(),
                ],
            );
        }
        receipt.publication = Some(Review {
            args,
            digest: view.seal(policy, &receipt.digest),
        });
        report.handoff = Some(receipt);
    }
    Ok(())
}

pub(super) fn approved(
    dataset: &Dataset,
    policy: &Policy,
    prior: Option<&Receipt>,
    snapshot: &str,
) -> Result<Option<(Receipt, Publication)>, EngineError> {
    let Some(prior) = prior else { return Ok(None) };
    if prior.bundle.is_some() {
        return Ok(None);
    }
    let Some(review) = &prior.publication else {
        return Ok(None);
    };
    let selection = Receipt {
        publication: None,
        ..prior.clone()
    };
    if original(dataset, Some(&selection), snapshot)?.is_none() {
        return Ok(None);
    }
    let Some(options) = options(policy, &review.args) else {
        return Ok(None);
    };
    let (view, findings) = build(policy, &options);
    Ok(
        (findings.is_empty() && view.seal(policy, &prior.digest) == review.digest)
            .then_some((prior.clone(), view)),
    )
}

pub(super) fn inspect(
    dataset: &Dataset,
    policy: &Policy,
    report: &mut Report,
    args: &[String],
    prior: Option<&Receipt>,
    snapshot: &str,
) -> Result<(), EngineError> {
    let Some(selection) = original(dataset, prior, snapshot)? else {
        report.reject(
            "selection",
            "Read the verified catalog selection before opening a source.",
        );
        return Ok(());
    };
    let view = &args[1];
    if args[0] == "selected" {
        report.row("Catalog selection", [selection.digest]);
        for document in &policy.documents {
            report.row(&document.record, ["Sealed source JSON".into()]);
        }
        return Ok(());
    }
    let Some(document) = policy
        .documents
        .iter()
        .find(|document| document.record == args[0])
    else {
        report.reject(
            "source",
            "Use a record listed in the verified catalog selection.",
        );
        return Ok(());
    };
    let source = fields(document);
    let body = &source["body"];
    match view.as_str() {
        "json" => {
            let row = report.row("Sealed source JSON", [digest(document.json.as_bytes())]);
            row.serialized = Some(document.json.clone());
            row.copy_label = Some("Copy original JSON");
            let raw = body.raw_span(span(document)).unwrap();
            row.source = Some(search::context(
                &document.json,
                coordinates(&document.json, raw),
            ));
        }
        "body" | "fold" => {
            let decoded = span(document);
            let raw = body.raw_span(decoded.clone()).unwrap();
            let row = report.row("Body · staff-contact", []);
            row.source = Some(search::context(
                &body.value,
                coordinates(&body.value, decoded.clone()),
            ));
            row.inspect.push(body.value[decoded].to_owned());
            let row = report.row("Raw JSON contribution", []);
            row.source = Some(search::context(
                &document.json,
                coordinates(&document.json, raw),
            ));
            if view == "fold" {
                let folded = transform(&body.value, Normalization::Nfc, Case::Fold)?;
                for (start, word) in folded.text.match_indices(&key(&source["contact"].value)) {
                    let cover = folded.cover(start..start + word.len()).unwrap();
                    let row = report.row("Folded key and original cover", [word.into()]);
                    row.details
                        .push(format!("Folded UTF-8 [{start}, {})", start + word.len()));
                    row.source = Some(search::context(
                        &body.value,
                        coordinates(&body.value, cover),
                    ));
                }
            }
        }
        "fields" => {
            for name in SOURCE_FIELDS {
                let row = report.row(*name, [source[*name].value.clone()]);
                row.details.push(
                    if matches!(*name, "title" | "sample") {
                        "Release evidence"
                    } else {
                        "Review source"
                    }
                    .into(),
                );
            }
        }
        _ => report.reject("source", "Views: body, fold, json, fields."),
    }
    Ok(())
}

pub(super) fn map_span(
    dataset: &Dataset,
    policy: &Policy,
    report: &mut Report,
    args: &[String],
    prior: Option<&Receipt>,
    snapshot: &str,
) -> Result<(), EngineError> {
    if original(dataset, prior, snapshot)?.is_none() {
        report.reject(
            "selection",
            "Read the verified catalog selection before mapping a span.",
        );
        return Ok(());
    }
    let (Some(document), Some(range)) = (
        policy
            .documents
            .iter()
            .find(|document| document.record == args[0]),
        parse_range(&args[2]),
    ) else {
        report.reject("source", "Use a selected record and a start-end range.");
        return Ok(());
    };
    let source = fields(document);
    let body = &source["body"];
    let mapped = match args[1].as_str() {
        "json" => body.decoded_span(range),
        "bytes" => body.value.get(range.clone()).map(|_| range),
        "graphemes" => {
            use unicode_segmentation::UnicodeSegmentation;
            let edges: Vec<_> = body
                .value
                .grapheme_indices(true)
                .map(|(index, _)| index)
                .chain([body.value.len()])
                .collect();
            edges
                .get(range.start)
                .zip(edges.get(range.end))
                .map(|(&start, &end)| start..end)
        }
        "scalars" | "utf16" => {
            let byte = |needle| {
                let mut offset = 0;
                for (index, scalar) in body.value.char_indices() {
                    if offset == needle {
                        return Some(index);
                    }
                    offset += if args[1] == "utf16" {
                        scalar.len_utf16()
                    } else {
                        1
                    };
                }
                (offset == needle).then_some(body.value.len())
            };
            byte(range.start)
                .zip(byte(range.end))
                .map(|(start, end)| start..end)
        }
        _ => None,
    };
    let Some(decoded) = mapped else {
        report.reject(
            "source",
            "The range is outside the body or cuts an encoded scalar.",
        );
        return Ok(());
    };
    let raw = body.raw_span(decoded.clone()).unwrap();
    report.row("Decoded body", []).source = Some(search::context(
        &body.value,
        coordinates(&body.value, decoded),
    ));
    report.row("Raw JSON", []).source = Some(search::context(
        &document.json,
        coordinates(&document.json, raw),
    ));
    Ok(())
}

pub(super) fn check_json(policy: Option<&Policy>, report: &mut Report, input: &str) {
    let raw = policy
        .and_then(|policy| policy.json_samples.get(input))
        .map_or(input, String::as_str);
    match json::parse(raw) {
        Ok(fields) => {
            report.check("json", true);
            let projected = fields
                .iter()
                .map(|(name, field)| (name, &field.value))
                .collect::<BTreeMap<_, _>>();
            let row = report.row(
                "Strict JSON · decoded and serialized",
                [json_text(&projected)],
            );
            row.serialized = Some(json_text(&projected));
            row.copy_label = Some("Copy JSON");
            for (name, field) in &fields {
                let row = report.row(name, [field.value.clone()]);
                if let Some(span) = field.raw_range() {
                    row.source = Some(search::context(raw, coordinates(raw, span)));
                }
                row.inspect.push(field.value.clone());
            }
        }
        Err(error) => report.reject(
            "json",
            format!("Strict interchange rejected this object · {error}"),
        ),
    }
}

pub(super) fn surfaces(
    dataset: &Dataset,
    policy: &Policy,
    report: &mut Report,
    view: &str,
    prior: Option<&Receipt>,
    snapshot: &str,
) -> Result<(), EngineError> {
    if original(dataset, prior, snapshot)?.is_none() {
        report.reject(
            "selection",
            "Read the verified catalog selection before opening candidate outputs.",
        );
        return Ok(());
    }
    let Some(options) = report
        .candidate
        .as_ref()
        .and_then(|args| options(policy, args))
    else {
        report.reject(
            "candidate",
            "Stage a release candidate before inspecting its outputs.",
        );
        return Ok(());
    };
    let (projection, _) = build(policy, &options);
    let text = match view {
        "body" => {
            review_rows(report, &projection);
            return Ok(());
        }
        "json" => projection.json,
        "index" => json_text(&projection.index),
        "metadata" => projection.metadata,
        "names" => json_text(&projection.filenames),
        "manifest" => projection.manifest,
        "log" => projection.log.join("\n"),
        _ => {
            report.reject(
                "surface",
                "Choose body, json, index, metadata, names, manifest or log.",
            );
            return Ok(());
        }
    };
    let row = report.row(view, [text.clone()]);
    row.serialized = Some(text);
    row.copy_label = Some("Copy candidate output");
    Ok(())
}
