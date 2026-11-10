use icu_normalizer::DecomposingNormalizer;
use serde::Serialize;

use crate::unicode::{collect, text_limit};
use crate::{EngineError, MAX_TEXT_BYTES};

mod data {
    include!(concat!(env!("OUT_DIR"), "/unicode_security.rs"));
}

pub const SECURITY_UNICODE_VERSION: &str = "15.1.0";
pub const UTS39_REVISION: u32 = 28;

fn mapped(scalar: char, table: &[(char, &'static str)]) -> impl Iterator<Item = char> {
    let (sequence, unchanged) = match table.binary_search_by_key(&scalar, |entry| entry.0) {
        Ok(index) => (table[index].1, None),
        Err(_) => ("", Some(scalar)),
    };
    sequence.chars().chain(unchanged)
}

pub fn case_fold(text: &str) -> Result<String, EngineError> {
    if text.len() > MAX_TEXT_BYTES {
        return Err(text_limit());
    }
    collect(
        text.chars()
            .flat_map(|scalar| mapped(scalar, data::CASE_FOLD)),
    )
}

fn default_ignorable(scalar: char) -> bool {
    let point = u32::from(scalar);
    let index = data::IGNORABLE.partition_point(|&(_, last)| last < point);
    data::IGNORABLE
        .get(index)
        .is_some_and(|&(first, _)| first <= point)
}

/// UTS #39 revision 28 §4 logical-order skeleton, using Unicode 15.1 throughout.
pub fn skeleton(text: &str) -> Result<String, EngineError> {
    if text.len() > MAX_TEXT_BYTES {
        return Err(text_limit());
    }
    let nfd = DecomposingNormalizer::new_nfd();
    let prototypes = nfd
        .normalize_iter(text.chars())
        .filter(|&scalar| !default_ignorable(scalar))
        .flat_map(|scalar| mapped(scalar, data::CONFUSABLES));
    collect(nfd.normalize_iter(prototypes))
}

fn script(scalar: char) -> &'static str {
    let point = u32::from(scalar);
    let index = data::SCRIPTS.partition_point(|&(_, last, _)| last < point);
    data::SCRIPTS
        .get(index)
        .filter(|&&(first, _, _)| first <= point)
        .map_or("Unknown", |&(_, _, script)| script)
}

#[derive(Serialize)]
pub struct Confusable {
    pub scalar: char,
    pub script: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScalarDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub script: &'static str,
    pub confusables: Vec<Confusable>,
    pub confusables_truncated: bool,
    pub unicode_version: &'static str,
}

pub fn scalar_details(scalar: char) -> ScalarDetails {
    const LIMIT: usize = 16;
    let script_of_scalar = script(scalar);
    let key = skeleton(scalar.encode_utf8(&mut [0; 4])).expect("single scalar fits the limit");
    // The last NFD step can change a prototype. Include the normalized key
    // itself when it is also a scalar, and verify candidates with the full algorithm.
    let nfd = DecomposingNormalizer::new_nfd();
    let prototype = key.chars().next().filter(|ch| ch.len_utf8() == key.len());
    let mut confusables: Vec<_> = data::CONFUSABLES
        .iter()
        .filter(|&&(_, prototype)| prototype == key || nfd.normalize(prototype) == key)
        .map(|&(candidate, _)| candidate)
        .chain(prototype)
        .filter(|&candidate| {
            candidate != scalar
                && skeleton(candidate.encode_utf8(&mut [0; 4])).is_ok_and(|value| value == key)
        })
        .map(|candidate| Confusable {
            scalar: candidate,
            script: script(candidate),
        })
        .collect();
    confusables.sort_unstable_by_key(|candidate| {
        (
            candidate.script == script_of_scalar
                || matches!(candidate.script, "Common" | "Inherited"),
            candidate.scalar,
        )
    });
    confusables.dedup_by_key(|candidate| candidate.scalar);
    let confusables_truncated = confusables.len() > LIMIT;
    confusables.truncate(LIMIT);
    ScalarDetails {
        name: unicode_names2::name(scalar).map(|name| name.to_string()),
        script: script_of_scalar,
        confusables,
        confusables_truncated,
        unicode_version: SECURITY_UNICODE_VERSION,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn property_ranges_are_nonoverlapping() {
        assert!(data::IGNORABLE.windows(2).all(|pair| pair[0].1 < pair[1].0));
        assert!(data::SCRIPTS.windows(2).all(|pair| pair[0].1 < pair[1].0));
    }
}
