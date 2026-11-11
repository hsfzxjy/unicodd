use std::ops::Range;

use serde::Serialize;
use unicode_normalization::char::{
    canonical_combining_class, compose, decompose_canonical, decompose_compatible,
};
use unicode_segmentation::UnicodeSegmentation;

use crate::{case_fold, EngineError};

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct Coordinates {
    pub utf8: [usize; 2],
    pub utf16: [usize; 2],
    pub scalars: [usize; 2],
    pub graphemes: [usize; 2],
    pub exact_graphemes: bool,
}

pub(super) fn coordinates(text: &str, span: Range<usize>) -> Coordinates {
    let boundaries: Vec<_> = text
        .grapheme_indices(true)
        .map(|(start, _)| start)
        .chain([text.len()])
        .collect();
    let start = boundaries.binary_search(&span.start);
    let end = boundaries.binary_search(&span.end);
    Coordinates {
        utf8: [span.start, span.end],
        utf16: [
            text[..span.start].encode_utf16().count(),
            text[..span.end].encode_utf16().count(),
        ],
        scalars: [
            text[..span.start].chars().count(),
            text[..span.end].chars().count(),
        ],
        graphemes: [
            start.unwrap_or_else(|index| index - 1),
            end.unwrap_or_else(|index| index),
        ],
        exact_graphemes: start.is_ok() && end.is_ok(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Normalization {
    Raw,
    Nfc,
    Nfd,
    Nfkc,
    StripMarks,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Case {
    Exact,
    Fold,
}

#[derive(Clone)]
struct Scalar {
    value: char,
    source: Range<usize>,
}

pub(super) struct Mapped {
    pub text: String,
    offsets: Vec<(usize, Range<usize>)>,
}

impl Mapped {
    pub fn cover(&self, bytes: Range<usize>) -> Option<Range<usize>> {
        let first = self
            .offsets
            .partition_point(|(index, _)| *index < bytes.start);
        let last = self
            .offsets
            .partition_point(|(index, _)| *index < bytes.end);
        self.offsets[first..last]
            .iter()
            .map(|(_, range)| range.clone())
            .reduce(union)
    }
}

fn union(first: Range<usize>, second: Range<usize>) -> Range<usize> {
    first.start.min(second.start)..first.end.max(second.end)
}

// UAX #15 decomposition, stable canonical ordering, then blocked composition.
// Each output scalar carries a covering range of the original contributors.
fn normalize(input: Vec<Scalar>, form: Normalization) -> Vec<Scalar> {
    if form == Normalization::Raw {
        return input;
    }
    let mut decomposed = Vec::new();
    for scalar in input {
        let emit = |value| {
            decomposed.push(Scalar {
                value,
                source: scalar.source.clone(),
            })
        };
        if form == Normalization::Nfkc {
            decompose_compatible(scalar.value, emit);
        } else {
            decompose_canonical(scalar.value, emit);
        }
    }
    let class = |scalar: &Scalar| canonical_combining_class(scalar.value);
    let mut start = 0;
    for index in 0..decomposed.len() {
        if class(&decomposed[index]) == 0 {
            decomposed[start..index].sort_by_key(class);
            start = index + 1;
        }
    }
    decomposed[start..].sort_by_key(class);

    if form == Normalization::Nfd {
        return decomposed;
    }
    if form == Normalization::StripMarks {
        // This deliberately lossy profile removes non-starter marks.
        return decomposed
            .into_iter()
            .filter(|scalar| class(scalar) == 0)
            .collect();
    }
    let mut composed: Vec<Scalar> = Vec::with_capacity(decomposed.len());
    let mut starter: Option<usize> = None;
    let mut previous_class = 0;
    for scalar in decomposed {
        let current_class = class(&scalar);
        if let Some(index) = starter {
            if previous_class == 0 || previous_class < current_class {
                if let Some(value) = compose(composed[index].value, scalar.value) {
                    composed[index].value = value;
                    composed[index].source = union(composed[index].source.clone(), scalar.source);
                    continue;
                }
            }
        }
        if current_class == 0 {
            starter = Some(composed.len());
        }
        previous_class = current_class;
        composed.push(scalar);
    }
    composed
}

pub(super) fn transform(
    text: &str,
    form: Normalization,
    case: Case,
) -> Result<Mapped, EngineError> {
    let input = text
        .char_indices()
        .map(|(start, value)| Scalar {
            value,
            source: start..start + value.len_utf8(),
        })
        .collect();
    let mut scalars = normalize(input, form);
    if case == Case::Fold {
        let mut folded = Vec::new();
        for scalar in scalars {
            folded.extend(
                case_fold(scalar.value.encode_utf8(&mut [0; 4]))?
                    .chars()
                    .map(|value| Scalar {
                        value,
                        source: scalar.source.clone(),
                    }),
            );
        }
        scalars = normalize(folded, form);
    }
    let mut result = Mapped {
        text: String::new(),
        offsets: Vec::with_capacity(scalars.len()),
    };
    for scalar in scalars {
        result.offsets.push((result.text.len(), scalar.source));
        result.text.push(scalar.value);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tagged_normalization_agrees_with_the_pinned_normalizer() {
        let input = [
            "\u{315}\u{300}e\u{315}\u{301}",
            "A\u{30a}\u{301}",
            "각",
            "Å",
            "ｎ／ﬃ",
            "e\u{301}\u{301}",
        ];
        for text in input {
            for (form, oracle) in [
                (Normalization::Nfc, crate::Form::NFC),
                (Normalization::Nfd, crate::Form::NFD),
                (Normalization::Nfkc, crate::Form::NFKC),
            ] {
                assert_eq!(
                    transform(text, form, Case::Exact).unwrap().text,
                    crate::normalize(text, oracle).unwrap()
                );
            }
        }
        let mapped = transform("📨e\u{315}\u{301}", Normalization::Nfc, Case::Exact).unwrap();
        assert_eq!(mapped.text, "📨é\u{315}");
        assert_eq!(mapped.cover(4..6), Some(4..9));
        let mapped = transform("aß", Normalization::Nfc, Case::Fold).unwrap();
        assert_eq!(mapped.text, "ass");
        assert_eq!(mapped.cover(2..3), Some(1..3));
    }
}
