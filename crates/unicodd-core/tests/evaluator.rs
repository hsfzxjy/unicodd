use std::collections::BTreeMap;

use serde_json::{json, Value as Json};
use unicodd_core::{
    evaluate, normalize, validate_program, ErrorCode, Form, Program, Value, MAX_TEXT_BYTES,
};

fn program(nodes: Json, checks: Json) -> Program {
    serde_json::from_value(json!({ "version": 1, "inputs": [], "nodes": nodes, "checks": checks }))
        .unwrap()
}

#[test]
fn all_operators_and_shared_dependencies() {
    let mut program = program(
        json!([
            {"id":"final","op":"and","args":["integer","boolean"]},
            {"id":"boolean","op":"booleanEqual","args":["and","yes"]},
            {"id":"integer","op":"integerEqual","args":["length","two"]},
            {"id":"and","op":"and","args":["exact","suffix"]},
            {"id":"or","op":"or","args":["contains","prefix"]},
            {"id":"not","op":"not","args":["or"]},
            {"id":"exact","op":"textEqual","args":["nfc","joined"]},
            {"id":"suffix","op":"endsWith","args":["nfc","emoji"]},
            {"id":"prefix","op":"startsWith","args":["nfc","emoji"]},
            {"id":"contains","op":"contains","args":["nfc","emoji"]},
            {"id":"length","op":"codePointLength","args":["nfc"]},
            {"id":"nfc","op":"normalize","args":["text"],"form":"NFC"},
            {"id":"joined","op":"concat","args":["accent","emoji"]},
            {"id":"accent","op":"literal","value":{"type":"text","value":"é"}},
            {"id":"emoji","op":"literal","value":{"type":"text","value":"🧪"}},
            {"id":"yes","op":"literal","value":{"type":"boolean","value":true}},
            {"id":"two","op":"literal","value":{"type":"integer","value":2}},
            {"id":"text","op":"input","input":"text"}
        ]),
        json!([
            {"id":"combined","node":"final","expected":true},
            {"id":"negative","node":"not","expected":false},
            {"id":"optional","node":"prefix","expected":true,"required":false}
        ]),
    );
    program.inputs.push("text".into());
    validate_program(&program).unwrap();
    let input = BTreeMap::from([("text".into(), "e\u{301}🧪".into())]);
    let result = evaluate(&program, &input, true).unwrap();
    assert!(result.solved);
    assert!(result.checks[0].passed);
    assert!(!result.checks[1].actual && result.checks[1].passed);
    assert!(!result.checks[2].passed && !result.checks[2].required);
    let trace = result.trace.unwrap();
    assert_eq!(trace.len(), program.nodes.len());
    for (index, record) in trace.iter().enumerate() {
        for dependency in record.dependencies {
            assert!(trace[..index].iter().any(|prior| prior.id == dependency));
        }
    }
    let actual: BTreeMap<_, _> = trace
        .iter()
        .map(|record| (record.id, &record.result))
        .collect();
    assert_eq!(actual["nfc"], &Value::Text("é🧪".into()));
    assert_eq!(actual["length"], &Value::Integer(2));
    assert_eq!(actual["prefix"], &Value::Boolean(false));
    assert_eq!(actual["contains"], &Value::Boolean(true));
    assert_eq!(actual["exact"], &Value::Boolean(true));
    assert_eq!(actual["suffix"], &Value::Boolean(true));
    assert_eq!(actual["or"], &Value::Boolean(true));
    assert_eq!(actual["boolean"], &Value::Boolean(true));
    assert!(evaluate(&program, &input, false).unwrap().trace.is_none());
    program.checks[2].required = true;
    assert!(!evaluate(&program, &input, false).unwrap().solved);
}

#[test]
fn normalization_forms_preserve_their_distinct_semantics() {
    let text = "e\u{301} ﬃ Ａ 👩\u{200d}💻";
    for (form, expected) in [
        (Form::NFC, "é ﬃ Ａ 👩\u{200d}💻"),
        (Form::NFD, "e\u{301} ﬃ Ａ 👩\u{200d}💻"),
        (Form::NFKC, "é ffi A 👩\u{200d}💻"),
        (Form::NFKD, "e\u{301} ffi A 👩\u{200d}💻"),
    ] {
        assert_eq!(normalize(text, form).unwrap(), expected);
    }
    assert_eq!(normalize("é", Form::NFD).unwrap(), "e\u{301}");
    assert_eq!(
        normalize("a\u{0315}\u{0300}", Form::NFC).unwrap(),
        "à\u{0315}"
    );
}

#[test]
fn comparison_is_exact_and_counting_uses_scalars() {
    let program = program(
        json!([
            {"id":"one","op":"literal","value":{"type":"text","value":"é"}},
            {"id":"two","op":"literal","value":{"type":"text","value":"e\u{301}"}},
            {"id":"different","op":"textEqual","args":["one","two"]},
            {"id":"emoji","op":"literal","value":{"type":"text","value":"👩\u{200d}💻"}},
            {"id":"count","op":"codePointLength","args":["emoji"]}
        ]),
        json!([{"id":"check","node":"different","expected":false}]),
    );
    let result = evaluate(&program, &BTreeMap::new(), true).unwrap();
    assert!(result.solved);
    assert_eq!(
        result.trace.unwrap().last().unwrap().result,
        Value::Integer(3)
    );
}

#[test]
fn validation_errors_are_structured() {
    let cases = [
        (
            json!([{"id":"a","op":"unknown"}]),
            json!([]),
            ErrorCode::UnsupportedOperation,
            "nodes[0]",
        ),
        (
            json!([{"id":"a","op":"not","args":[]}]),
            json!([]),
            ErrorCode::InvalidProgram,
            "nodes[0].args",
        ),
        (
            json!([{"id":"a","op":"not","args":["missing"]}]),
            json!([]),
            ErrorCode::InvalidProgram,
            "nodes[0].args",
        ),
        (
            json!([{"id":"a","op":"not","args":["b"]},{"id":"b","op":"not","args":["a"]}]),
            json!([]),
            ErrorCode::InvalidProgram,
            "nodes",
        ),
        (
            json!([{"id":"a","op":"not","args":["a"]}]),
            json!([]),
            ErrorCode::InvalidProgram,
            "nodes",
        ),
        (
            json!([{"id":"a","op":"input","input":"missing"}]),
            json!([]),
            ErrorCode::InvalidProgram,
            "nodes[0]",
        ),
        (
            json!([{"id":"a","op":"literal","value":{"type":"integer","value":9007199254740992_u64}}]),
            json!([]),
            ErrorCode::InvalidProgram,
            "nodes[0]",
        ),
        (
            json!([{"id":"a","op":"literal","value":{"type":"text","value":"x"}},{"id":"b","op":"not","args":["a"]}]),
            json!([]),
            ErrorCode::TypeMismatch,
            "nodes[1].args",
        ),
        (
            json!([{"id":"a","op":"literal","value":{"type":"text","value":"x"}}]),
            json!([{"id":"x","node":"a","expected":true}]),
            ErrorCode::TypeMismatch,
            "checks[0]",
        ),
        (
            json!([]),
            json!([{"id":"x","node":"a","expected":true}]),
            ErrorCode::InvalidProgram,
            "checks[0]",
        ),
        (
            json!([{"id":"a","op":"literal","value":{"type":"boolean","value":true}},{"id":"a","op":"not","args":["a"]}]),
            json!([]),
            ErrorCode::InvalidProgram,
            "nodes[1]",
        ),
        (
            json!([{"id":"a","op":"literal","value":{"type":"boolean","value":true}}]),
            json!([
                {"id":"x","node":"a","expected":true},{"id":"x","node":"a","expected":false}
            ]),
            ErrorCode::InvalidProgram,
            "checks[1]",
        ),
        (
            json!([{"id":"a","op":"literal","value":{"type":"boolean","value":true},"args":[]}]),
            json!([]),
            ErrorCode::InvalidProgram,
            "nodes[0]",
        ),
    ];
    for (nodes, checks, code, path) in cases {
        let error = validate_program(&program(nodes, checks)).unwrap_err();
        assert_eq!(error.code, code);
        assert_eq!(error.path.as_deref(), Some(path));
    }

    let mut definition = program(json!([]), json!([]));
    definition.version = 2;
    assert_eq!(
        validate_program(&definition).unwrap_err().path.as_deref(),
        Some("version")
    );
    definition.version = 1;
    definition.inputs = vec!["dup".into(), "dup".into()];
    assert_eq!(
        validate_program(&definition).unwrap_err().path.as_deref(),
        Some("inputs[1]")
    );
    assert!(serde_json::from_value::<Program>(json!({
        "version":1,"inputs":[],"nodes":[],"checks":[{"id":"check","node":"x","expected":"false"}]
    }))
    .is_err());
}

#[test]
fn rejects_missing_extra_and_oversized_inputs() {
    let mut definition = program(json!([]), json!([]));
    definition.inputs.push("text".into());
    let error = evaluate(&definition, &BTreeMap::new(), false).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidInput);
    assert_eq!(error.path.as_deref(), Some("inputs.text"));
    let values = BTreeMap::from([("text".into(), "".into()), ("extra".into(), "".into())]);
    assert_eq!(
        evaluate(&definition, &values, false).unwrap_err().code,
        ErrorCode::InvalidInput
    );
    let values = BTreeMap::from([("text".into(), "é".repeat(16_385))]);
    assert_eq!(
        evaluate(&definition, &values, false).unwrap_err().code,
        ErrorCode::ResourceLimit
    );
}

#[test]
fn bounds_graph_size_intermediate_expansion_and_trace() {
    let literal = |id: &str, length| json!({"id":id,"op":"literal","value":{"type":"text","value":"x".repeat(length)}});
    let oversized = program(json!(vec![literal("a", 0); 257]), json!([]));
    assert_eq!(
        validate_program(&oversized).unwrap_err().code,
        ErrorCode::ResourceLimit
    );
    let definition = program(
        json!([
            literal("a", MAX_TEXT_BYTES / 2 + 1),
            {"id":"c","op":"concat","args":["a","a"]}
        ]),
        json!([]),
    );
    let error = evaluate(&definition, &BTreeMap::new(), true).unwrap_err();
    assert_eq!(error.code, ErrorCode::ResourceLimit);
    assert_eq!(error.path.as_deref(), Some("nodes[1]"));
    assert_eq!(
        normalize(&"ﬃ".repeat(MAX_TEXT_BYTES / 3), Form::NFKD)
            .unwrap()
            .len(),
        MAX_TEXT_BYTES / 3 * 3
    );
    assert_eq!(
        normalize(&"é".repeat(MAX_TEXT_BYTES / 2), Form::NFD)
            .unwrap_err()
            .code,
        ErrorCode::ResourceLimit
    );

    let nodes: Vec<_> = (0..5)
        .map(|i| literal(&format!("n{i}"), MAX_TEXT_BYTES))
        .collect();
    let definition = program(json!(nodes), json!([]));
    let result = evaluate(&definition, &BTreeMap::new(), true).unwrap();
    assert!(result.solved && result.trace_truncated);
    assert_eq!(result.trace.unwrap().len(), 4);
}

#[test]
fn counts_the_three_text_encodings_without_normalizing() {
    let program = program(
        json!([
            {"id":"value","op":"input","input":"text"},
            {"id":"scalars","op":"codePointLength","args":["value"]},
            {"id":"units","op":"utf16_length","args":["value"]},
            {"id":"bytes","op":"utf8_length","args":["value"]}
        ]),
        json!([]),
    );
    let mut program = program;
    program.inputs.push("text".into());
    for (text, expected) in [
        ("", [0, 0, 0]),
        ("e\u{301}", [2, 2, 3]),
        ("\u{1D40C}AINT", [5, 6, 8]),
        ("\u{1D40C}ＡINT", [5, 6, 10]),
    ] {
        let values: Vec<_> = evaluate(
            &program,
            &BTreeMap::from([("text".into(), text.into())]),
            true,
        )
        .unwrap()
        .trace
        .unwrap()
        .into_iter()
        .skip(1)
        .map(|entry| entry.result)
        .collect();
        assert_eq!(values, expected.map(Value::Integer));
    }
}
