use std::ptr;

use unicodd_ops_core::{AbiStatus, unicodd_grapheme_boundaries};

const GRAPHEME_BREAK_TEST: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/data/GraphemeBreakTest-17.0.0.txt"
));

fn unpack(value: u64) -> (u32, u32) {
    ((value >> 32) as u32, value as u32)
}

fn segment(input: &[u32]) -> Vec<u32> {
    let query = unicodd_grapheme_boundaries(input.as_ptr(), input.len() as u32, ptr::null_mut(), 0);
    let (status, required) = unpack(query);
    assert!(
        status == AbiStatus::InsufficientCapacity as u32
            || (status == AbiStatus::Success as u32 && required == 0),
        "capacity query failed with status {status} and detail {required}"
    );

    let mut output = vec![0; required as usize];
    let result = unicodd_grapheme_boundaries(
        input.as_ptr(),
        input.len() as u32,
        output.as_mut_ptr(),
        required,
    );
    assert_eq!(
        unpack(result),
        (AbiStatus::Success as u32, required),
        "grapheme-boundary write failed"
    );
    output
}

fn parse_case(data: &str) -> (Vec<u32>, Vec<u32>) {
    let mut scalars = Vec::new();
    let mut boundaries = Vec::new();

    for token in data.split_whitespace() {
        match token {
            "÷" => boundaries.push(scalars.len() as u32),
            "×" => {}
            scalar => scalars
                .push(u32::from_str_radix(scalar, 16).expect("valid conformance test scalar")),
        }
    }
    (scalars, boundaries)
}

#[test]
fn passes_unicode_17_grapheme_break_conformance() {
    assert!(GRAPHEME_BREAK_TEST.starts_with("# GraphemeBreakTest-17.0.0.txt"));
    let mut cases = 0usize;

    for (zero_based_line, raw_line) in GRAPHEME_BREAK_TEST.lines().enumerate() {
        let data = raw_line.split('#').next().unwrap_or_default().trim();
        if data.is_empty() {
            continue;
        }

        let (scalars, expected) = parse_case(data);
        assert_eq!(
            segment(&scalars),
            expected,
            "Unicode 17 grapheme conformance failure on line {}",
            zero_based_line + 1
        );
        cases += 1;
    }

    assert_eq!(
        cases, 766,
        "the pinned conformance corpus changed unexpectedly"
    );
}
