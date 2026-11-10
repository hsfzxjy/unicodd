use std::collections::BTreeMap;

use serde::{de::DeserializeOwned, Serialize};
use wasm_bindgen::prelude::*;

use crate::{self as core, EngineError, ErrorCode, Form, Program, SCHEMA_VERSION};

const MAX_PROGRAM_WIRE_BYTES: usize = 13 * 1024 * 1024;
const MAX_INPUT_WIRE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(untagged)]
enum Response<T> {
    Success { ok: bool, value: T },
    Failure { ok: bool, error: EngineError },
}

fn respond<T: Serialize>(result: Result<T, EngineError>) -> String {
    let response = match result {
        Ok(value) => Response::Success { ok: true, value },
        Err(error) => Response::Failure { ok: false, error },
    };
    serde_json::to_string(&response).unwrap_or_else(|_| {
        r#"{"ok":false,"error":{"code":"evaluation_failure","message":"Could not serialize the result."}}"#.into()
    })
}

fn parse<T: DeserializeOwned>(
    bytes: &[u8],
    limit: usize,
    code: ErrorCode,
    path: &str,
) -> Result<T, EngineError> {
    if bytes.len() > limit {
        return Err(EngineError::new(
            ErrorCode::ResourceLimit,
            "Request exceeds the transport limit.",
        )
        .at(path));
    }
    serde_json::from_slice(bytes)
        .map_err(|error| EngineError::new(code, error.to_string()).at(path))
}

#[wasm_bindgen]
pub fn engine_info() -> String {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Info {
        version: u32,
        unicode_version: String,
    }
    let (major, minor, patch) = core::unicode_version();
    respond(Ok(Info {
        version: SCHEMA_VERSION,
        unicode_version: format!("{major}.{minor}.{patch}"),
    }))
}

#[wasm_bindgen]
pub fn validate_program(program: &[u8]) -> String {
    respond(
        parse(
            program,
            MAX_PROGRAM_WIRE_BYTES,
            ErrorCode::InvalidProgram,
            "program",
        )
        .and_then(|program| core::validate_program(&program)),
    )
}

#[wasm_bindgen]
pub fn evaluate(program: &[u8], inputs: &[u8], trace: bool) -> String {
    let program: Program = match parse(
        program,
        MAX_PROGRAM_WIRE_BYTES,
        ErrorCode::InvalidProgram,
        "program",
    ) {
        Ok(program) => program,
        Err(error) => return respond::<()>(Err(error)),
    };
    let inputs: BTreeMap<String, String> = match parse(
        inputs,
        MAX_INPUT_WIRE_BYTES,
        ErrorCode::InvalidInput,
        "inputs",
    ) {
        Ok(inputs) => inputs,
        Err(error) => return respond::<()>(Err(error)),
    };
    respond(core::evaluate(&program, &inputs, trace))
}

#[wasm_bindgen]
pub fn normalize_text(text: &[u8], form: &str) -> String {
    let form = match form {
        "NFC" => Form::NFC,
        "NFD" => Form::NFD,
        "NFKC" => Form::NFKC,
        "NFKD" => Form::NFKD,
        _ => {
            return respond::<()>(Err(EngineError::new(
                ErrorCode::InvalidInput,
                "Unknown normalization form.",
            )
            .at("form")))
        }
    };
    if text.len() > core::MAX_TEXT_BYTES {
        return respond::<()>(Err(crate::unicode::text_limit().at("text")));
    }
    respond(
        std::str::from_utf8(text)
            .map_err(|_| {
                EngineError::new(ErrorCode::InvalidInput, "Text must be valid UTF-8.").at("text")
            })
            .and_then(|text| core::normalize(text, form).map_err(|error| error.at("text"))),
    )
}
