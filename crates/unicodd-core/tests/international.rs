use std::cmp::Ordering;

use unicodd_core::international::*;

#[test]
fn comparison_and_sort_key_agree_for_tailored_and_literal_ties() {
    let titles = ["Aterstallning", "Återställning", "Åtkomst", "Återställning"];
    for locale in [SortLocale::English, SortLocale::Swedish] {
        for strength in [
            SortStrength::Primary,
            SortStrength::Secondary,
            SortStrength::Tertiary,
        ] {
            let collation = collator(locale, strength);
            for a in titles {
                for b in titles {
                    assert_eq!(
                        collation.compare(a, b),
                        sort_key(&collation, a).cmp(&sort_key(&collation, b))
                    );
                }
            }
        }
    }
    let [a, b, ..] = titles;
    assert_eq!(
        collator(SortLocale::English, SortStrength::Primary).compare(a, b),
        Ordering::Equal
    );
    assert_eq!(
        collator(SortLocale::English, SortStrength::Tertiary).compare(a, b),
        Ordering::Less
    );
    assert_eq!(
        collator(SortLocale::Swedish, SortStrength::Primary).compare(a, b),
        Ordering::Less
    );
}

#[test]
fn case_mapping_is_locale_aware_and_context_sensitive() {
    let vectors = [
        (CaseLocale::Und, "IRIS", "iris"),
        (CaseLocale::Tr, "IRIS", "ırıs"),
        (CaseLocale::Az, "IRIS", "ırıs"),
        (CaseLocale::Tr, "I", "ı"),
        (CaseLocale::Tr, "ı", "ı"),
        (CaseLocale::Und, "İ", "i\u{307}"),
        (CaseLocale::Tr, "I\u{307}", "i"),
        (CaseLocale::Lt, "I\u{301}", "i\u{307}\u{301}"),
        (CaseLocale::Und, "ΟΣ", "ος"),
        (CaseLocale::Und, "ΟΣΑ", "οσα"),
    ];
    for (locale, original, expected) in vectors {
        assert_eq!(lowercase(original, locale), expected);
    }
    assert_eq!(unicodd_core::case_fold("ΟΣ").unwrap(), "οσ");
}

#[test]
fn segmentation_reports_byte_boundaries_for_extended_clusters() {
    let original = "Cafe\u{301}👩‍💻!";
    assert_eq!(grapheme_count(original), 6);
    assert_eq!(
        grapheme_boundaries(original).collect::<Vec<_>>(),
        [0, 1, 2, 3, 6, 17, 18]
    );
    assert_eq!(grapheme_boundaries("").collect::<Vec<_>>(), [0]);
    assert_eq!(truncate_graphemes(original, 4), "Cafe\u{301}");
    assert_eq!(truncate_graphemes(original, 5), "Cafe\u{301}👩‍💻");
    assert_eq!(truncate_graphemes(original, 0), "");
    assert_eq!(truncate_graphemes(original, 64), original);
}

#[test]
fn bidi_isolates_keep_the_registration_anchor_in_its_field() {
    let (before, field, after) = ("CASE ", "تمت ", " 0002917 STATE APPROVED");
    assert!(!field_stays_between(before, field, after));
    assert!(field_stays_between(before, &isolate(field), after));
    assert!(audit_visual_order(&format!("{before}{field}{after}")).starts_with("CASE 0002917"));
    let input = "ok\u{202E}12";
    assert_eq!(escape_controls(input), "ok[U+202E]12");
    assert_eq!(input.chars().nth(2), Some('\u{202E}'));
}
