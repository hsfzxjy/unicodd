use crate::{EngineError, ErrorCode, Form};
use unicode_normalization::{UnicodeNormalization, UNICODE_VERSION};

pub const MAX_TEXT_BYTES: usize = 128 * 1024;

pub fn unicode_version() -> (u8, u8, u8) {
    UNICODE_VERSION
}

pub fn normalize(text: &str, form: Form) -> Result<String, EngineError> {
    if text.len() > MAX_TEXT_BYTES {
        return Err(text_limit());
    }
    match form {
        Form::NFC => collect(text.nfc()),
        Form::NFD => collect(text.nfd()),
        Form::NFKC => collect(text.nfkc()),
        Form::NFKD => collect(text.nfkd()),
    }
}

fn collect(scalars: impl Iterator<Item = char>) -> Result<String, EngineError> {
    let mut result = String::new();
    for scalar in scalars {
        if result.len() + scalar.len_utf8() > MAX_TEXT_BYTES {
            return Err(text_limit());
        }
        result.push(scalar);
    }
    Ok(result)
}

pub(crate) fn text_limit() -> EngineError {
    EngineError::new(
        ErrorCode::ResourceLimit,
        "Text exceeds the 128 KiB UTF-8 limit.",
    )
}
