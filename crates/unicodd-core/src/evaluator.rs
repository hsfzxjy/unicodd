use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use crate::schema::Kind::{self, Boolean, Integer, Text};
use crate::unicode::text_limit;
use crate::*;

const MAX_NODES: usize = 256;
const MAX_INPUTS: usize = 32;
const MAX_CHECKS: usize = 128;
const MAX_INPUT_BYTES: usize = 32 * 1024;
const MAX_TOTAL_INPUT_BYTES: usize = 256 * 1024;
const MAX_GRAPH_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_TRACE_TEXT_BYTES: usize = 512 * 1024;

#[derive(Clone, Copy)]
enum Operation<'a> {
    Input(&'a str),
    Literal(&'a Value),
    TextEqual,
    Concat,
    Normalize(Form),
    CodePointLength,
    Utf16Length,
    Utf8Length,
    RemoveCodePoint,
    CaseFold,
    Skeleton,
    Contains,
    StartsWith,
    EndsWith,
    Not,
    And,
    Or,
    BooleanEqual,
    IntegerEqual,
    IntegerLessOrEqual,
}

impl Operation<'_> {
    fn signature(self) -> (&'static [Kind], Kind) {
        match self {
            Self::Input(_) => (&[], Text),
            Self::Literal(value) => (&[], value.kind()),
            Self::TextEqual | Self::Contains | Self::StartsWith | Self::EndsWith => {
                (&[Text, Text], Boolean)
            }
            Self::Concat => (&[Text, Text], Text),
            Self::Normalize(_) | Self::CaseFold | Self::Skeleton => (&[Text], Text),
            Self::RemoveCodePoint => (&[Text, Integer], Text),
            Self::CodePointLength | Self::Utf16Length | Self::Utf8Length => (&[Text], Integer),
            Self::Not => (&[Boolean], Boolean),
            Self::And | Self::Or | Self::BooleanEqual => (&[Boolean, Boolean], Boolean),
            Self::IntegerEqual | Self::IntegerLessOrEqual => (&[Integer, Integer], Boolean),
        }
    }
}

struct Compiled<'a> {
    ops: Vec<Operation<'a>>,
    deps: Vec<Vec<usize>>,
    order: Vec<usize>,
    checks: Vec<usize>,
}

pub fn validate_program(program: &Program) -> Result<(), EngineError> {
    compile(program).map(|_| ())
}

fn invalid(message: impl Into<String>) -> EngineError {
    EngineError::new(ErrorCode::InvalidProgram, message)
}

fn identifier(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
}

fn scalar(value: u64) -> Option<char> {
    u32::try_from(value).ok().and_then(char::from_u32)
}

fn operation(node: &Node) -> Result<Operation<'_>, EngineError> {
    let op = match node.op.as_str() {
        "input" => Operation::Input(
            node.input
                .as_deref()
                .ok_or_else(|| invalid("Missing input."))?,
        ),
        "literal" => Operation::Literal(
            node.value
                .as_ref()
                .ok_or_else(|| invalid("Missing literal value."))?,
        ),
        "textEqual" => Operation::TextEqual,
        "concat" => Operation::Concat,
        "normalize" => Operation::Normalize(
            node.form
                .ok_or_else(|| invalid("Missing normalization form."))?,
        ),
        "caseFold" => Operation::CaseFold,
        "skeleton" => Operation::Skeleton,
        "remove_code_point" => Operation::RemoveCodePoint,
        "codePointLength" => Operation::CodePointLength,
        "utf16_length" => Operation::Utf16Length,
        "utf8_length" => Operation::Utf8Length,
        "contains" => Operation::Contains,
        "startsWith" => Operation::StartsWith,
        "endsWith" => Operation::EndsWith,
        "not" => Operation::Not,
        "and" => Operation::And,
        "or" => Operation::Or,
        "booleanEqual" => Operation::BooleanEqual,
        "integerEqual" => Operation::IntegerEqual,
        "integerLessOrEqual" => Operation::IntegerLessOrEqual,
        _ => {
            return Err(EngineError::new(
                ErrorCode::UnsupportedOperation,
                "Unknown operation.",
            ))
        }
    };
    if (node.input.is_some() && !matches!(op, Operation::Input(_)))
        || (node.value.is_some() && !matches!(op, Operation::Literal(_)))
        || (node.form.is_some() && !matches!(op, Operation::Normalize(_)))
        || (node.args.is_some() && op.signature().0.is_empty())
    {
        return Err(invalid("Unexpected field for this operation."));
    }
    Ok(op)
}

fn compile(program: &Program) -> Result<Compiled<'_>, EngineError> {
    if program.version != SCHEMA_VERSION {
        return Err(invalid("Unsupported schema version.").at("version"));
    }
    for (path, count, limit) in [
        ("inputs", program.inputs.len(), MAX_INPUTS),
        ("nodes", program.nodes.len(), MAX_NODES),
        ("checks", program.checks.len(), MAX_CHECKS),
    ] {
        if count > limit {
            return Err(EngineError::new(
                ErrorCode::ResourceLimit,
                format!("At most {limit} entries are allowed."),
            )
            .at(path));
        }
    }

    let mut inputs = HashSet::new();
    for (index, id) in program.inputs.iter().enumerate() {
        if !identifier(id) || !inputs.insert(id.as_str()) {
            return Err(
                invalid("Invalid or duplicate input identifier.").at(format!("inputs[{index}]"))
            );
        }
    }

    let mut ids = HashMap::new();
    let mut ops = Vec::with_capacity(program.nodes.len());
    let mut literal_bytes = 0;
    for (index, node) in program.nodes.iter().enumerate() {
        let path = format!("nodes[{index}]");
        if !identifier(&node.id) || ids.insert(node.id.as_str(), index).is_some() {
            return Err(invalid("Invalid or duplicate node identifier.").at(path));
        }
        let op = operation(node).map_err(|error| error.at(&path))?;
        match op {
            Operation::Input(id) if !inputs.contains(id) => {
                return Err(invalid("Input is not declared.").at(path));
            }
            Operation::Literal(Value::Integer(value)) if *value > MAX_SAFE_INTEGER => {
                return Err(invalid("Integer exceeds the JSON safe integer range.").at(path));
            }
            Operation::Literal(Value::Text(text)) => {
                if text.len() > MAX_TEXT_BYTES {
                    return Err(text_limit().at(path));
                }
                literal_bytes += text.len();
                if literal_bytes > MAX_GRAPH_TEXT_BYTES {
                    return Err(EngineError::new(
                        ErrorCode::ResourceLimit,
                        "Combined literal text exceeds 2 MiB.",
                    )
                    .at(path));
                }
            }
            _ => {}
        }
        ops.push(op);
    }

    let mut deps = Vec::with_capacity(ops.len());
    let mut consumers = vec![Vec::new(); ops.len()];
    for (index, (node, op)) in program.nodes.iter().zip(&ops).enumerate() {
        let args = node.args.as_deref().unwrap_or_default();
        let types = op.signature().0;
        let path = format!("nodes[{index}].args");
        if types.len() != args.len() {
            return Err(invalid(format!("Expected {} arguments.", types.len())).at(path));
        }
        let mut resolved = Vec::with_capacity(types.len());
        for (arg, kind) in args.iter().zip(types) {
            let dependency = *ids
                .get(arg.as_str())
                .ok_or_else(|| invalid("Unknown dependency.").at(&path))?;
            if ops[dependency].signature().1 != *kind {
                return Err(EngineError::new(
                    ErrorCode::TypeMismatch,
                    format!("Argument {} requires {kind:?}.", resolved.len() + 1),
                )
                .at(path));
            }
            resolved.push(dependency);
            consumers[dependency].push(index);
        }
        if matches!(op, Operation::RemoveCodePoint) {
            if let Operation::Literal(Value::Integer(value)) = ops[resolved[1]] {
                if scalar(*value).is_none() {
                    return Err(invalid("Expected a Unicode scalar value.").at(path));
                }
            }
        }
        deps.push(resolved);
    }

    let order = topological_order(&deps, &consumers)?;
    let mut check_ids = HashSet::new();
    let mut checks = Vec::with_capacity(program.checks.len());
    for (index, check) in program.checks.iter().enumerate() {
        let path = format!("checks[{index}]");
        if !identifier(&check.id) || !check_ids.insert(&check.id) {
            return Err(invalid("Invalid or duplicate check identifier.").at(path));
        }
        let node = *ids
            .get(check.node.as_str())
            .ok_or_else(|| invalid("Unknown check node.").at(&path))?;
        if ops[node].signature().1 != Boolean {
            return Err(EngineError::new(
                ErrorCode::TypeMismatch,
                "Checks require a Boolean node.",
            )
            .at(path));
        }
        checks.push(node);
    }

    Ok(Compiled {
        ops,
        deps,
        order,
        checks,
    })
}

fn topological_order(
    deps: &[Vec<usize>],
    consumers: &[Vec<usize>],
) -> Result<Vec<usize>, EngineError> {
    let mut remaining: Vec<_> = deps.iter().map(Vec::len).collect();
    let mut queue: VecDeque<_> = (0..deps.len())
        .filter(|&index| remaining[index] == 0)
        .collect();
    let mut order = Vec::with_capacity(deps.len());
    while let Some(index) = queue.pop_front() {
        order.push(index);
        for &consumer in &consumers[index] {
            remaining[consumer] -= 1;
            if remaining[consumer] == 0 {
                queue.push_back(consumer);
            }
        }
    }
    if order.len() != deps.len() {
        return Err(invalid("The graph contains a dependency cycle.").at("nodes"));
    }
    Ok(order)
}

fn validate_inputs(
    program: &Program,
    inputs: &BTreeMap<String, String>,
) -> Result<(), EngineError> {
    let mut total = 0;
    for id in &program.inputs {
        let value = inputs.get(id).ok_or_else(|| {
            EngineError::new(ErrorCode::InvalidInput, "Missing declared input.")
                .at(format!("inputs.{id}"))
        })?;
        if value.len() > MAX_INPUT_BYTES {
            return Err(EngineError::new(
                ErrorCode::ResourceLimit,
                "Input exceeds 32 KiB of UTF-8.",
            )
            .at(format!("inputs.{id}")));
        }
        total += value.len();
    }
    if inputs.len() != program.inputs.len() {
        return Err(EngineError::new(
            ErrorCode::InvalidInput,
            "Input values include an undeclared key.",
        )
        .at("inputs"));
    }
    if total > MAX_TOTAL_INPUT_BYTES {
        return Err(EngineError::new(
            ErrorCode::ResourceLimit,
            "Combined inputs exceed 256 KiB of UTF-8.",
        )
        .at("inputs"));
    }
    Ok(())
}

fn inconsistent() -> EngineError {
    EngineError::new(
        ErrorCode::EvaluationFailure,
        "A validated dependency produced an unexpected value.",
    )
}

fn run(
    op: Operation<'_>,
    args: &[Option<&Value>],
    inputs: &BTreeMap<String, String>,
) -> Result<Value, EngineError> {
    use Operation::*;
    match (op, args) {
        (Input(id), []) => inputs
            .get(id)
            .cloned()
            .map(Value::Text)
            .ok_or_else(inconsistent),
        (Literal(value), []) => Ok(value.clone()),
        (TextEqual, [Some(Value::Text(a)), Some(Value::Text(b))]) => Ok(Value::Boolean(a == b)),
        (Contains, [Some(Value::Text(a)), Some(Value::Text(b))]) => {
            Ok(Value::Boolean(a.contains(b)))
        }
        (StartsWith, [Some(Value::Text(a)), Some(Value::Text(b))]) => {
            Ok(Value::Boolean(a.starts_with(b)))
        }
        (EndsWith, [Some(Value::Text(a)), Some(Value::Text(b))]) => {
            Ok(Value::Boolean(a.ends_with(b)))
        }
        (Concat, [Some(Value::Text(a)), Some(Value::Text(b))]) => {
            if a.len() + b.len() > MAX_TEXT_BYTES {
                return Err(text_limit());
            }
            let mut text = String::with_capacity(a.len() + b.len());
            text.push_str(a);
            text.push_str(b);
            Ok(Value::Text(text))
        }
        (Normalize(form), [Some(Value::Text(text))]) => Ok(Value::Text(normalize(text, form)?)),
        (CaseFold, [Some(Value::Text(text))]) => Ok(Value::Text(case_fold(text)?)),
        (Skeleton, [Some(Value::Text(text))]) => Ok(Value::Text(skeleton(text)?)),
        (RemoveCodePoint, [Some(Value::Text(text)), Some(Value::Integer(value))]) => {
            let scalar = scalar(*value).ok_or_else(|| {
                EngineError::new(ErrorCode::InvalidInput, "Expected a Unicode scalar value.")
            })?;
            Ok(Value::Text(
                text.chars()
                    .filter(|character| *character != scalar)
                    .collect(),
            ))
        }
        (Utf16Length, [Some(Value::Text(text))]) => {
            Ok(Value::Integer(text.encode_utf16().count() as u64))
        }
        (Utf8Length, [Some(Value::Text(text))]) => Ok(Value::Integer(text.len() as u64)),
        (CodePointLength, [Some(Value::Text(text))]) => {
            Ok(Value::Integer(text.chars().count() as u64))
        }
        (Not, [Some(Value::Boolean(a))]) => Ok(Value::Boolean(!a)),
        (And, [Some(Value::Boolean(a)), Some(Value::Boolean(b))]) => Ok(Value::Boolean(*a && *b)),
        (Or, [Some(Value::Boolean(a)), Some(Value::Boolean(b))]) => Ok(Value::Boolean(*a || *b)),
        (BooleanEqual, [Some(Value::Boolean(a)), Some(Value::Boolean(b))]) => {
            Ok(Value::Boolean(a == b))
        }
        (IntegerLessOrEqual, [Some(Value::Integer(a)), Some(Value::Integer(b))]) => {
            Ok(Value::Boolean(a <= b))
        }
        (IntegerEqual, [Some(Value::Integer(a)), Some(Value::Integer(b))]) => {
            Ok(Value::Boolean(a == b))
        }
        _ => Err(inconsistent()),
    }
}

pub fn evaluate<'a>(
    program: &'a Program,
    inputs: &BTreeMap<String, String>,
    include_trace: bool,
) -> Result<Evaluation<'a>, EngineError> {
    let graph = compile(program)?;
    validate_inputs(program, inputs)?;
    let mut values = vec![None; graph.ops.len()];
    let mut total = 0;
    for &index in &graph.order {
        let args: Vec<_> = graph.deps[index]
            .iter()
            .map(|&dep| values[dep].as_ref())
            .collect();
        let value = run(graph.ops[index], &args, inputs)
            .map_err(|error| error.at(format!("nodes[{index}]")))?;
        total += value.text_bytes();
        if total > MAX_GRAPH_TEXT_BYTES {
            return Err(EngineError::new(
                ErrorCode::ResourceLimit,
                "Combined intermediate text exceeds 2 MiB.",
            )
            .at(format!("nodes[{index}]")));
        }
        values[index] = Some(value);
    }

    let mut checks = Vec::with_capacity(graph.checks.len());
    for (check, index) in program.checks.iter().zip(graph.checks) {
        let Some(Value::Boolean(actual)) = values[index] else {
            return Err(inconsistent());
        };
        checks.push(CheckResult {
            id: &check.id,
            actual,
            expected: check.expected,
            passed: actual == check.expected,
            required: check.required,
        });
    }
    let solved = checks.iter().all(|check| !check.required || check.passed);
    let mut trace_truncated = false;
    let trace = if include_trace {
        let mut trace = Vec::with_capacity(graph.order.len());
        let mut bytes = 0;
        for index in graph.order {
            let node = &program.nodes[index];
            let result = values[index].take().ok_or_else(inconsistent)?;
            bytes += result.text_bytes();
            if bytes > MAX_TRACE_TEXT_BYTES {
                trace_truncated = true;
                break;
            }
            trace.push(TraceRecord {
                id: &node.id,
                op: &node.op,
                dependencies: node.args.as_deref().unwrap_or_default(),
                result,
            });
        }
        Some(trace)
    } else {
        None
    };
    Ok(Evaluation {
        solved,
        checks,
        trace,
        trace_truncated,
    })
}
