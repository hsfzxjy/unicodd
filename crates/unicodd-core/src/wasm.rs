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
        case_folding_version: &'static str,
        skeleton_version: &'static str,
        uts39_revision: u32,
        recovery_version: u32,
        collation_profile: &'static str,
        casing_profile: &'static str,
        grapheme_version: &'static str,
        bidi_version: &'static str,
    }
    let (major, minor, patch) = core::unicode_version();
    respond(Ok(Info {
        version: SCHEMA_VERSION,
        unicode_version: format!("{major}.{minor}.{patch}"),
        case_folding_version: core::SECURITY_UNICODE_VERSION,
        skeleton_version: core::SECURITY_UNICODE_VERSION,
        uts39_revision: core::UTS39_REVISION,
        recovery_version: core::recovery::VERSION,
        collation_profile: core::international::COLLATION_PROFILE,
        casing_profile: core::international::CASING_PROFILE,
        grapheme_version: core::international::GRAPHEME_VERSION,
        bidi_version: core::international::BIDI_VERSION,
    }))
}

#[wasm_bindgen]
pub fn validate_dossier_dataset(dataset: &[u8]) -> String {
    respond(
        parse(
            dataset,
            MAX_INPUT_WIRE_BYTES,
            ErrorCode::InvalidProgram,
            "dataset",
        )
        .and_then(|dataset| core::dossier::validate(&dataset)),
    )
}

#[wasm_bindgen]
pub fn run_dossier(request: &[u8]) -> String {
    respond(
        parse(
            request,
            MAX_INPUT_WIRE_BYTES,
            ErrorCode::InvalidInput,
            "request",
        )
        .and_then(core::dossier::run),
    )
}

#[wasm_bindgen]
pub fn validate_recovery_dataset(dataset: &[u8]) -> String {
    respond(
        parse(
            dataset,
            MAX_INPUT_WIRE_BYTES,
            ErrorCode::InvalidProgram,
            "dataset",
        )
        .and_then(|dataset| core::recovery::validate_dataset(&dataset)),
    )
}

#[wasm_bindgen]
pub fn run_recovery(request: &[u8]) -> String {
    respond(
        parse(
            request,
            MAX_INPUT_WIRE_BYTES,
            ErrorCode::InvalidInput,
            "request",
        )
        .and_then(core::recovery::run),
    )
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

#[wasm_bindgen]
pub fn inspect_scalar(text: &[u8]) -> String {
    let scalar = std::str::from_utf8(text).ok().and_then(|text| {
        let mut chars = text.chars();
        let first = chars.next()?;
        chars.next().is_none().then_some(first)
    });
    respond(scalar.map(core::scalar_details).ok_or_else(|| {
        EngineError::new(ErrorCode::InvalidInput, "Expected one Unicode scalar.").at("text")
    }))
}
