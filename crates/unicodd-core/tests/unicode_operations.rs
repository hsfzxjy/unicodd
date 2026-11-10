use std::collections::BTreeMap;

use serde_json::{json, Value as Json};
use unicodd_core::{evaluate, scalar_details, validate_program, ErrorCode, Program, Value};

fn graph(op: &str, scalar: Option<Json>) -> Program {
    let mut nodes = vec![json!({"id":"raw","op":"input","input":"text"})];
    let mut args = vec!["raw"];
    if let Some(value) = scalar {
        nodes.push(json!({"id":"scalar","op":"literal","value":value}));
        args.push("scalar");
    }
    nodes.push(json!({"id":"result","op":op,"args":args}));
    serde_json::from_value(json!({
        "version":1,"inputs":["text"],"nodes":nodes,"checks":[]
    }))
    .unwrap()
}

#[test]
fn unicode_operations_match_the_shared_wasm_vectors() {
    let cases: Vec<Json> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/unicode-operations.json"
    ))
    .unwrap();
    for case in cases {
        let op = case["op"].as_str().unwrap();
        let text = case["text"].as_str().unwrap();
        let expected = case["expected"].as_str().unwrap();
        let program = graph(
            op,
            case.get("scalar")
                .map(|scalar| json!({"type":"integer","value":scalar})),
        );
        validate_program(&program).unwrap();
        let inputs = BTreeMap::from([("text".into(), text.into())]);
        let trace = evaluate(&program, &inputs, true).unwrap().trace.unwrap();
        assert_eq!(
            trace.last().unwrap().result,
            Value::Text(expected.into()),
            "{op}({text:?})"
        );
    }
}

#[test]
fn remove_code_point_rejects_non_scalars_and_wrong_types() {
    for value in [0xd800, 0xdfff, 0x110000, u64::from(u32::MAX) + 1] {
        let invalid = graph(
            "remove_code_point",
            Some(json!({"type":"integer","value":value})),
        );
        let issue = validate_program(&invalid).unwrap_err();
        assert_eq!(issue.code, ErrorCode::InvalidProgram);
        assert_eq!(issue.path.as_deref(), Some("nodes[2].args"));
    }
    let wrong_type = graph(
        "remove_code_point",
        Some(json!({"type":"text","value":"x"})),
    );
    assert_eq!(
        validate_program(&wrong_type).unwrap_err().code,
        ErrorCode::TypeMismatch
    );

    let dynamic: Program = serde_json::from_value(json!({
        "version":1,"inputs":[],"checks":[],"nodes":[
            {"id":"long","op":"literal","value":{"type":"text","value":"x".repeat(0xd800)}},
            {"id":"scalar","op":"codePointLength","args":["long"]},
            {"id":"result","op":"remove_code_point","args":["long","scalar"]}
        ]
    }))
    .unwrap();
    validate_program(&dynamic).unwrap();
    let issue = evaluate(&dynamic, &BTreeMap::new(), false).unwrap_err();
    assert_eq!(issue.code, ErrorCode::InvalidInput);
    assert_eq!(issue.path.as_deref(), Some("nodes[2]"));
}

#[test]
fn scalar_inspection_uses_versioned_names_scripts_and_related_mappings() {
    let latin = scalar_details('i');
    assert_eq!(latin.name.as_deref(), Some("LATIN SMALL LETTER I"));
    assert_eq!(latin.unicode_version, "15.1.0");
    assert_eq!(latin.script, "Latin");
    assert!(latin.confusables.len() <= 16);
    assert!(latin
        .confusables
        .iter()
        .any(|entry| entry.scalar == '\u{0456}' && entry.script == "Cyrillic"));
    assert!(scalar_details('\u{0456}')
        .confusables
        .iter()
        .any(|entry| entry.scalar == 'i'));
    assert_eq!(
        scalar_details('\u{200b}').name.as_deref(),
        Some("ZERO WIDTH SPACE")
    );
}
