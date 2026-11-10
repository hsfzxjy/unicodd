use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Program {
    pub version: u32,
    pub inputs: Vec<String>,
    pub nodes: Vec<Node>,
    pub checks: Vec<Check>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Node {
    pub id: String,
    pub op: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub form: Option<Form>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub enum Form {
    NFC,
    NFD,
    NFKC,
    NFKD,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "type",
    content = "value",
    rename_all = "lowercase",
    deny_unknown_fields
)]
pub enum Value {
    Text(String),
    Boolean(bool),
    Integer(u64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Text,
    Boolean,
    Integer,
}

impl Value {
    pub(crate) fn kind(&self) -> Kind {
        match self {
            Self::Text(_) => Kind::Text,
            Self::Boolean(_) => Kind::Boolean,
            Self::Integer(_) => Kind::Integer,
        }
    }

    pub(crate) fn text_bytes(&self) -> usize {
        match self {
            Self::Text(text) => text.len(),
            _ => 0,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Check {
    pub id: String,
    pub node: String,
    pub expected: bool,
    #[serde(default = "required")]
    pub required: bool,
}

fn required() -> bool {
    true
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidProgram,
    InvalidInput,
    UnsupportedOperation,
    TypeMismatch,
    EvaluationFailure,
    ResourceLimit,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct EngineError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl EngineError {
    pub(crate) fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
        }
    }

    pub(crate) fn at(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.path {
            Some(path) => write!(formatter, "{path}: {}", self.message),
            None => formatter.write_str(&self.message),
        }
    }
}

impl std::error::Error for EngineError {}

#[derive(Debug, Serialize)]
pub struct CheckResult<'a> {
    pub id: &'a str,
    pub actual: bool,
    pub expected: bool,
    pub passed: bool,
    pub required: bool,
}

#[derive(Debug, Serialize)]
pub struct TraceRecord<'a> {
    pub id: &'a str,
    pub op: &'a str,
    pub dependencies: &'a [String],
    pub result: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evaluation<'a> {
    pub solved: bool,
    pub checks: Vec<CheckResult<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace: Option<Vec<TraceRecord<'a>>>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub trace_truncated: bool,
}
