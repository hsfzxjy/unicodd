use std::ptr;

use unicodd_ops_core::{AbiStatus, NormalizationForm, unicodd_normalize};

const NORMALIZATION_TEST: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/data/NormalizationTest-17.0.0.txt"
));

fn unpack(value: u64) -> (u32, u32) {
    ((value >> 32) as u32, value as u32)
}

fn normalize(form: NormalizationForm, input: &[u32]) -> Vec<u32> {
    let query = unicodd_normalize(
        form as u32,
        input.as_ptr(),
        input.len() as u32,
        ptr::null_mut(),
        0,
    );
    let (status, required) = unpack(query);
    assert!(
        status == AbiStatus::InsufficientCapacity as u32
            || (status == AbiStatus::Success as u32 && required == 0),
        "capacity query failed with status {status} and detail {required}"
    );

    let mut output = vec![0; required as usize];
    let result = unicodd_normalize(
        form as u32,
        input.as_ptr(),
        input.len() as u32,
        output.as_mut_ptr(),
        required,
    );
    assert_eq!(
        unpack(result),
        (AbiStatus::Success as u32, required),
        "normalization write failed"
    );
    output
}

fn parse_scalars(field: &str) -> Vec<u32> {
    field
        .split_ascii_whitespace()
        .map(|value| u32::from_str_radix(value, 16).expect("valid conformance test scalar"))
        .collect()
}

fn assert_normalizes(line_number: usize, form: NormalizationForm, input: &[u32], expected: &[u32]) {
    assert_eq!(
        normalize(form, input),
        expected,
        "Unicode 17 normalization conformance failure on line {line_number} for {form:?}"
    );
}

#[test]
fn passes_unicode_17_normalization_conformance() {
    assert!(NORMALIZATION_TEST.starts_with("# NormalizationTest-17.0.0.txt"));
    let mut cases = 0usize;

    for (zero_based_line, raw_line) in NORMALIZATION_TEST.lines().enumerate() {
        let data = raw_line.split('#').next().unwrap_or_default().trim();
        if data.is_empty() || data.starts_with('@') {
            continue;
        }

        let columns: Vec<Vec<u32>> = data.split(';').take(5).map(parse_scalars).collect();
        assert_eq!(
            columns.len(),
            5,
            "invalid test row at line {}",
            zero_based_line + 1
        );
        let [c1, c2, c3, c4, c5] = columns.as_slice() else {
            unreachable!("column count was checked")
        };
        let line_number = zero_based_line + 1;

        for input in [c1, c2, c3] {
            assert_normalizes(line_number, NormalizationForm::Nfc, input, c2);
            assert_normalizes(line_number, NormalizationForm::Nfd, input, c3);
        }
        for input in [c4, c5] {
            assert_normalizes(line_number, NormalizationForm::Nfc, input, c4);
            assert_normalizes(line_number, NormalizationForm::Nfd, input, c5);
        }
        for input in [c1, c2, c3, c4, c5] {
            assert_normalizes(line_number, NormalizationForm::Nfkc, input, c4);
            assert_normalizes(line_number, NormalizationForm::Nfkd, input, c5);
        }

        cases += 1;
    }

    assert_eq!(
        cases, 20_034,
        "the pinned conformance corpus changed unexpectedly"
    );
}
