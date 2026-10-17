use std::ptr;
use unicodd_ops_core::unicodd_case_fold;

const CASE_FOLDING: &str = include_str!("../../../tools/unicode-data/17.0.0/CaseFolding.txt");

fn unpack(value: u64) -> (u32, u32) {
    ((value >> 32) as u32, value as u32)
}

fn fold(input: &[u32]) -> Vec<u32> {
    let query = unicodd_case_fold(input.as_ptr(), input.len() as u32, ptr::null_mut(), 0);
    let (status, required) = unpack(query);
    assert!(status == 1 || (status == 0 && required == 0));

    let mut output = vec![0; required as usize];
    let result = unicodd_case_fold(
        input.as_ptr(),
        input.len() as u32,
        output.as_mut_ptr(),
        required,
    );
    assert_eq!(unpack(result), (0, required));
    output
}

#[test]
fn passes_unicode_17_default_full_case_folding_data() {
    let mut checked = 0usize;
    for line in CASE_FOLDING.lines() {
        let data = line.split('#').next().unwrap_or_default().trim();
        if data.is_empty() {
            continue;
        }
        let fields: Vec<_> = data.split(';').map(str::trim).collect();
        if !matches!(fields.get(1), Some(&"C") | Some(&"F")) {
            continue;
        }
        let scalar = u32::from_str_radix(fields[0], 16).expect("valid source scalar");
        let expected: Vec<u32> = fields[2]
            .split_ascii_whitespace()
            .map(|value| u32::from_str_radix(value, 16).expect("valid mapped scalar"))
            .collect();
        assert_eq!(
            fold(&[scalar]),
            expected,
            "case-fold mismatch for U+{scalar:04X}"
        );
        checked += 1;
    }

    assert!(
        checked > 1_500,
        "expected the complete Unicode 17 case-fold data"
    );
}
