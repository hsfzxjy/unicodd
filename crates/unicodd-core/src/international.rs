use std::cmp::Ordering;

use icu_casemap::CaseMapper;
use icu_collator::{
    options::{CollatorOptions, Strength},
    Collator, CollatorBorrowed,
};
use icu_locale_core::{locale, Locale};
use serde::{Deserialize, Serialize};
use unicode_bidi::{BidiInfo, Level};
use unicode_segmentation::UnicodeSegmentation;

pub const COLLATION_PROFILE: &str = "icu4x-2.1.1-cldr-48.0-icu-78.1rc-v1";
pub const CASING_PROFILE: &str = "icu4x-2.1.1-unicode-17.0-icu-78.1rc";
pub const GRAPHEME_VERSION: &str = "16.0.0";
pub const BIDI_VERSION: &str = "16.0.0";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum SortLocale {
    #[serde(rename = "en-US")]
    English,
    #[serde(rename = "sv-SE")]
    Swedish,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SortStrength {
    Primary,
    Secondary,
    Tertiary,
}

pub fn collator(locale: SortLocale, strength: SortStrength) -> CollatorBorrowed<'static> {
    let locale: Locale = match locale {
        SortLocale::English => locale!("en-US"),
        SortLocale::Swedish => locale!("sv-SE"),
    };
    let mut options = CollatorOptions::default();
    options.strength = Some(match strength {
        SortStrength::Primary => Strength::Primary,
        SortStrength::Secondary => Strength::Secondary,
        SortStrength::Tertiary => Strength::Tertiary,
    });
    Collator::try_new(locale.into(), options).expect("compiled collation profiles")
}

pub fn sort_key(collator: &CollatorBorrowed<'_>, text: &str) -> Vec<u8> {
    let mut key = Vec::new();
    let Ok(()) = collator.write_sort_key_to(text, &mut key);
    key
}

pub fn comparison_label(order: Ordering) -> &'static str {
    match order {
        Ordering::Less => "less",
        Ordering::Equal => "equal",
        Ordering::Greater => "greater",
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CaseLocale {
    Und,
    Tr,
    Az,
    Lt,
}

pub fn lowercase(text: &str, locale: CaseLocale) -> String {
    let locale = match locale {
        CaseLocale::Und => locale!("und"),
        CaseLocale::Tr => locale!("tr"),
        CaseLocale::Az => locale!("az"),
        CaseLocale::Lt => locale!("lt"),
    };
    CaseMapper::new()
        .lowercase_to_string(text, &locale.id)
        .into_owned()
}

pub fn grapheme_boundaries(text: &str) -> impl Iterator<Item = usize> + '_ {
    text.grapheme_indices(true)
        .map(|(offset, _)| offset)
        .chain(std::iter::once(text.len()))
}

pub fn grapheme_count(text: &str) -> usize {
    text.graphemes(true).count()
}

pub fn truncate_graphemes(text: &str, count: usize) -> &str {
    &text[..grapheme_boundaries(text).nth(count).unwrap_or(text.len())]
}

pub fn is_formatting_control(c: char) -> bool {
    // Bidi_Control plus paragraph/line breakers and other general controls. These
    // must never reach a dynamic field in an audit line as live formatting.
    c.is_control()
        || matches!(c, '\u{061C}' | '\u{200E}'..='\u{200F}' | '\u{2028}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

pub fn escape_controls(text: &str) -> String {
    let mut safe = String::new();
    for c in text.chars() {
        if is_formatting_control(c) {
            use std::fmt::Write;
            write!(safe, "[U+{:04X}]", c as u32).expect("write to String");
        } else {
            safe.push(c);
        }
    }
    safe
}

pub fn isolate(text: &str) -> String {
    format!("\u{2068}{text}\u{2069}")
}

// A single audit line has fixed LTR anchors on either side of one dynamic field.
// Check resolved visual positions, excluding format controls that render no glyph.
pub fn field_stays_between(prefix: &str, field: &str, suffix: &str) -> bool {
    let text = format!("{prefix}{field}{suffix}");
    let bidi = BidiInfo::new(&text, Some(Level::ltr()));
    let [paragraph] = bidi.paragraphs.as_slice() else {
        return false;
    };
    let levels = bidi.reordered_levels(paragraph, paragraph.range.clone());
    let characters: Vec<_> = text.char_indices().collect();
    let scalar_levels: Vec<_> = characters.iter().map(|(byte, _)| levels[*byte]).collect();
    let mut last = 0;
    for index in BidiInfo::reorder_visual(&scalar_levels) {
        let (byte, c) = characters[index];
        if is_formatting_control(c) || c.is_whitespace() {
            continue;
        }
        let part =
            usize::from(byte >= prefix.len()) + usize::from(byte >= prefix.len() + field.len());
        if part < last {
            return false;
        }
        last = part;
    }
    true
}

pub fn audit_visual_order(text: &str) -> String {
    let bidi = BidiInfo::new(text, Some(Level::ltr()));
    bidi.paragraphs
        .iter()
        .map(|para| bidi.reorder_line(para, para.range.clone()))
        .collect::<Vec<_>>()
        .join("")
}
