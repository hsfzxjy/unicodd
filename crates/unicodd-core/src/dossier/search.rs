use std::{collections::BTreeSet, ops::Range};

use serde::Serialize;
use unicode_normalization::char::decompose_canonical;
use unicode_segmentation::UnicodeSegmentation;

use super::{
    digest, digest_json, identifier,
    spans::{coordinates, transform, Case, Coordinates, Normalization},
    Dataset, Receipt, Report, Source, VERSION,
};
use crate::{skeleton, EngineError};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Boundary {
    Default,
    French,
    Substring,
    Ascii,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Comparison {
    Scalar(Normalization, Case),
    Skeleton,
}

impl Comparison {
    fn key(self, text: &str) -> Result<String, EngineError> {
        match self {
            Self::Scalar(form, case) => Ok(transform(text, form, case)?.text),
            Self::Skeleton => skeleton(text),
        }
    }
}

#[derive(Clone, Copy)]
struct Profile {
    boundary: Boundary,
    index: Comparison,
    query: Comparison,
}

const CANONICAL: Comparison = Comparison::Scalar(Normalization::Nfc, Case::Fold);
const OFFICIAL: Profile = Profile {
    boundary: Boundary::French,
    index: CANONICAL,
    query: CANONICAL,
};

fn comparison(form: &str, casing: &str) -> Option<Comparison> {
    let case = match casing {
        "exact" => Case::Exact,
        "fold" => Case::Fold,
        _ => return None,
    };
    Some(Comparison::Scalar(
        match form {
            "raw" => Normalization::Raw,
            "nfc" => Normalization::Nfc,
            "nfd" => Normalization::Nfd,
            "nfkc" => Normalization::Nfkc,
            "strip" => Normalization::StripMarks,
            "skeleton" => return Some(Comparison::Skeleton),
            _ => return None,
        },
        case,
    ))
}

fn profile(value: &str) -> Option<Profile> {
    let parts = value.split('/').collect::<Vec<_>>();
    let [mode, form, casing, query @ ..] = parts.as_slice() else {
        return None;
    };
    let boundary = match *mode {
        "default" => Boundary::Default,
        "fr" => Boundary::French,
        "substring" => Boundary::Substring,
        "ascii" => Boundary::Ascii,
        _ => return None,
    };
    let index = comparison(form, casing)?;
    let query = match query {
        [] => index,
        [form, casing] => comparison(form, casing)?,
        _ => return None,
    };
    if matches!(boundary, Boundary::Ascii | Boundary::Substring) && index == Comparison::Skeleton {
        return None;
    }
    Some(Profile {
        boundary,
        index,
        query,
    })
}

fn vowel(scalar: char) -> bool {
    let mut first = None;
    decompose_canonical(scalar, |scalar| {
        first.get_or_insert(scalar);
    });
    first.is_some_and(|c| "aeiouyAEIOUYæÆœŒ".contains(c))
}

fn segments(text: &str, boundary: Boundary) -> Vec<Range<usize>> {
    let mut ranges = vec![];
    for (offset, segment) in text.split_word_bound_indices() {
        let mut start = offset;
        if boundary == Boundary::French {
            let mut chars = segment.char_indices().peekable();
            while let Some((_, c)) = chars.next() {
                if matches!(c, '\'' | '’') {
                    if let Some(&(next, _)) = chars.peek().filter(|(_, c)| vowel(*c)) {
                        let next = offset + next;
                        ranges.push(start..next);
                        start = next;
                    }
                }
            }
        }
        ranges.push(start..offset + segment.len());
    }
    ranges
}

fn ascii_boundary(text: &str, offset: usize) -> bool {
    let word =
        |byte: Option<&u8>| byte.is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_');
    word(
        offset
            .checked_sub(1)
            .and_then(|index| text.as_bytes().get(index)),
    ) != word(text.as_bytes().get(offset))
}

fn find(text: &str, key: &str, profile: Profile) -> Result<Vec<Range<usize>>, EngineError> {
    let mut hits = Vec::new();
    match profile.boundary {
        Boundary::Default | Boundary::French => {
            for span in segments(text, profile.boundary) {
                let token = &text[span.clone()];
                if token.unicode_words().next().is_some() && profile.index.key(token)? == key {
                    hits.push(span);
                }
            }
        }
        Boundary::Substring | Boundary::Ascii => {
            let Comparison::Scalar(form, case) = profile.index else {
                unreachable!()
            };
            let mapped = transform(text, form, case)?;
            // Advance on scalar boundaries to retain overlapping occurrences too.
            for (start, _) in mapped.text.char_indices() {
                if mapped.text[start..].starts_with(key) {
                    let end = start + key.len();
                    if profile.boundary == Boundary::Ascii
                        && !(ascii_boundary(&mapped.text, start)
                            && ascii_boundary(&mapped.text, end))
                    {
                        continue;
                    }
                    if let Some(span) = mapped.cover(start..end) {
                        hits.push(span);
                    }
                }
            }
        }
    }
    Ok(hits)
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct Hit {
    pub record: String,
    pub field: String,
    pub span: Coordinates,
    source_digest: String,
}

fn search(
    dataset: &Dataset,
    query: &str,
    profile: Profile,
    scope: &str,
) -> Result<Vec<Hit>, EngineError> {
    let key = profile.query.key(query)?;
    let mut hits = vec![];
    if key.is_empty() {
        return Ok(hits);
    }
    for record in &dataset.records {
        for (field, text) in &record.fields {
            let selected = match scope {
                "all" => true,
                "approved" => dataset.approved_fields.contains(field),
                _ => scope == field,
            };
            if selected {
                for span in find(text, &key, profile)? {
                    hits.push(Hit {
                        record: record.id.clone(),
                        field: field.clone(),
                        span: coordinates(text, span),
                        source_digest: digest(text.as_bytes()),
                    });
                }
            }
        }
    }
    Ok(hits)
}

pub(super) fn official(dataset: &Dataset) -> Result<Vec<Hit>, EngineError> {
    search(dataset, &dataset.query, OFFICIAL, "approved")
}

fn ids(hits: &[Hit]) -> BTreeSet<&str> {
    hits.iter().map(|hit| hit.record.as_str()).collect()
}

pub(super) fn matches_ledger(dataset: &Dataset, hits: &[Hit]) -> bool {
    ids(hits) == ledger(dataset)
}

fn ledger(dataset: &Dataset) -> BTreeSet<&str> {
    dataset
        .records
        .iter()
        .filter(|record| record.eligible)
        .map(|record| record.id.as_str())
        .collect()
}

fn field<'a>(dataset: &'a Dataset, id: &str, field: &str) -> Option<&'a str> {
    dataset
        .records
        .iter()
        .find(|record| record.id == id)?
        .fields
        .get(field)
        .map(String::as_str)
}

pub(super) fn context(text: &str, span: Coordinates) -> Source {
    let [start, end] = span.utf8;
    let left = text[..start]
        .char_indices()
        .rev()
        .nth(23)
        .map_or(0, |(index, _)| index);
    let right = text[end..]
        .char_indices()
        .nth(24)
        .map_or(text.len(), |(index, _)| end + index);
    Source {
        before: text[left..start].into(),
        hit: text[start..end].into(),
        after: text[end..right].into(),
        coordinates: span,
    }
}

fn rows(dataset: &Dataset, report: &mut Report, hits: &[Hit]) {
    report.row(
        "Search results",
        [format!(
            "{} records · {} occurrences",
            ids(hits).len(),
            hits.len()
        )],
    );
    for hit in hits.iter().take(80) {
        let text = field(dataset, &hit.record, &hit.field).unwrap();
        let source = context(text, hit.span);
        let row = report.row(format!("{} · {}", hit.record, hit.field), []);
        row.inspect.push(source.hit.clone());
        row.source = Some(source);
    }
    if hits.len() > 80 {
        report.row(
            "More occurrences",
            ["Narrow the field scope or use a more specific query.".into()],
        );
    }
}

fn candidate(dataset: &Dataset, args: &[String]) -> Option<Profile> {
    let [query, mode, scope] = args else {
        return None;
    };
    if query.is_empty()
        || query.len() > 128
        || !(matches!(scope.as_str(), "all" | "approved")
            || identifier(scope)
                && dataset
                    .records
                    .iter()
                    .any(|record| record.fields.contains_key(scope)))
    {
        return None;
    }
    profile(mode)
}

pub(super) fn stage(
    dataset: &Dataset,
    report: &mut Report,
    args: Vec<String>,
) -> Result<(), EngineError> {
    report.candidate = None;
    let Some(profile) = candidate(dataset, &args) else {
        report.reject(
            "profile",
            "Enter a query, a search profile and a field scope from the catalog reference.",
        );
        return Ok(());
    };
    report.check("profile", true);
    let hits = search(dataset, &args[0], profile, &args[2])?;
    report.row(
        "Query key",
        [
            profile.query.key(&args[0])?,
            args[1].clone(),
            args[2].clone(),
        ],
    );
    rows(dataset, report, &hits);
    report.candidate = Some(args);
    Ok(())
}

pub(super) fn tokens(
    dataset: &Dataset,
    report: &mut Report,
    args: &[String],
) -> Result<(), EngineError> {
    let (Some(text), Some(profile)) = (field(dataset, &args[0], &args[1]), profile(&args[2]))
    else {
        report.reject(
            "profile",
            "Use a catalog record, its field and a supported search profile.",
        );
        return Ok(());
    };
    report.check("profile", true);
    if let (Boundary::Ascii | Boundary::Substring, Comparison::Scalar(form, case)) =
        (profile.boundary, profile.index)
    {
        let mapped = transform(text, form, case)?;
        report.row("Original field", [text.to_owned()]);
        report.row("Comparison field", [mapped.text.clone()]);
        if profile.boundary == Boundary::Substring {
            report.row(
                "Substring matching",
                [
                    "A match can start and end at any scalar boundary in the comparison field."
                        .into(),
                ],
            );
            return Ok(());
        }
        report.row(
            "ASCII word edges",
            ["Both ends of a match must fall on edges of the ASCII word runs below. Byte offsets refer to the comparison field.".into()],
        );
        let mut edges =
            (0..=mapped.text.len()).filter(|&offset| ascii_boundary(&mapped.text, offset));
        let mut count = 0;
        while let (Some(start), Some(end)) = (edges.next(), edges.next()) {
            count += 1;
            if count <= 48 {
                let row = report.row(
                    "ASCII word run",
                    [
                        format!("{start}..{end}"),
                        mapped.text[start..end].to_owned(),
                    ],
                );
                if let Some(original) = mapped.cover(start..end) {
                    row.source = Some(context(text, coordinates(text, original)));
                }
            }
        }
        if count == 0 {
            report.row("ASCII word runs", ["None".into()]);
        } else if count > 48 {
            report.row("More ASCII word runs", [format!("{} omitted", count - 48)]);
        }
        return Ok(());
    }
    report.row(
        "Word boundaries",
        [format!(
            "UAX #29 / Unicode {} · {}",
            crate::international::GRAPHEME_VERSION,
            args[2]
        )],
    );
    for range in segments(text, profile.boundary).into_iter().take(48) {
        let row = report.row("Segment", [profile.index.key(&text[range.clone()])?]);
        row.source = Some(context(text, coordinates(text, range)));
    }
    Ok(())
}

pub(super) fn select(
    dataset: &Dataset,
    report: &mut Report,
    snapshot: String,
) -> Result<(), EngineError> {
    let Some(args) = report.candidate.clone() else {
        report.reject(
            "candidate",
            "Run a search before reconciling its selection.",
        );
        return Ok(());
    };
    match verify(dataset, &args, &snapshot)? {
        Ok((receipt, hits)) => {
            report.check("candidate", true);
            report.check("record-set", true);
            report.check("source-spans", true);
            rows(dataset, report, &hits);
            report.row("Verified selection", [receipt.digest.clone()]);
            report.handoff = Some(receipt);
        }
        Err(issue) => report.reject(issue.0, issue.1),
    }
    Ok(())
}

pub(super) fn verify(
    dataset: &Dataset,
    args: &[String],
    snapshot: &str,
) -> Result<Result<(Receipt, Vec<Hit>), (&'static str, String)>, EngineError> {
    let Some(profile) = candidate(dataset, args) else {
        return Ok(Err((
            "candidate",
            "The stored search profile is invalid. Run the search again.".into(),
        )));
    };
    let hits = search(dataset, &args[0], profile, &args[2])?;
    let actual = ids(&hits);
    let expected = ledger(dataset);
    if expected != actual {
        let missing = expected
            .difference(&actual)
            .copied()
            .collect::<Vec<_>>()
            .join(", ");
        let extra = actual
            .difference(&expected)
            .copied()
            .collect::<Vec<_>>()
            .join(", ");
        return Ok(Err((
            "record-set",
            format!(
                "Ledger disagreement · missing [{}] · surplus [{}]",
                missing, extra
            ),
        )));
    }
    let expected = official(dataset)?;
    if hits != expected {
        let difference = expected
            .iter()
            .find(|hit| !hits.contains(hit))
            .or_else(|| hits.iter().find(|hit| !expected.contains(hit)))
            .unwrap();
        return Ok(Err((
            "source-spans",
            format!(
                "Occurrence disagreement in {} · {}. Compare its original field boundaries.",
                difference.record, difference.field
            ),
        )));
    }
    let receipt = Receipt {
        version: VERSION,
        snapshot: snapshot.into(),
        selection: args.to_vec(),
        digest: digest_json(&(snapshot, &hits)),
        publication: None,
        bundle: None,
    };
    Ok(Ok((receipt, hits)))
}
