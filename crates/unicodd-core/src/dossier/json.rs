use std::{collections::BTreeMap, ops::Range};

pub(super) struct JsonString {
    pub value: String,
    pieces: Vec<(Range<usize>, Range<usize>)>,
}

impl JsonString {
    /// Return the raw JSON range covering decoded UTF-8 scalar contributions.
    pub fn raw_span(&self, decoded: Range<usize>) -> Option<Range<usize>> {
        let first = self
            .pieces
            .iter()
            .find(|(span, _)| span.start == decoded.start)?;
        let last = self
            .pieces
            .iter()
            .find(|(span, _)| span.end == decoded.end)?;
        (decoded.start < decoded.end).then(|| first.1.start..last.1.end)
    }

    pub fn decoded_span(&self, raw: Range<usize>) -> Option<Range<usize>> {
        let first = self
            .pieces
            .iter()
            .find(|(_, span)| span.start == raw.start)?;
        let last = self.pieces.iter().find(|(_, span)| span.end == raw.end)?;
        (raw.start < raw.end).then(|| first.0.start..last.0.end)
    }

    pub fn raw_range(&self) -> Option<Range<usize>> {
        Some(self.pieces.first()?.1.start..self.pieces.last()?.1.end)
    }
}

/// The source and interoperability exercise use a flat object of strings.
/// Let serde validate the grammar and scalar encoding before scanning token ranges.
pub(super) fn parse(raw: &str) -> Result<BTreeMap<String, JsonString>, String> {
    let start = skip(raw, 0);
    if raw.as_bytes().get(start) != Some(&b'{') {
        return Err("Expected a flat JSON object of strings.".into());
    }
    serde_json::from_str::<BTreeMap<String, String>>(raw).map_err(|issue| issue.to_string())?;
    let mut cursor = start + 1;
    let mut fields = BTreeMap::new();
    loop {
        cursor = skip(raw, cursor);
        if raw.as_bytes()[cursor] == b'}' {
            return Ok(fields);
        }
        let (key, next) = string(raw, cursor);
        let value_start = skip(raw, skip(raw, next) + 1); // colon
        let (value, next) = string(raw, value_start);
        if fields.insert(key.value.clone(), value).is_some() {
            return Err(format!("Duplicate decoded member name {:?}", key.value));
        }
        cursor = skip(raw, next);
        if raw.as_bytes()[cursor] == b',' {
            cursor += 1;
        }
    }
}

fn skip(raw: &str, mut cursor: usize) -> usize {
    while matches!(
        raw.as_bytes().get(cursor),
        Some(b' ' | b'\n' | b'\r' | b'\t')
    ) {
        cursor += 1;
    }
    cursor
}

fn string(raw: &str, start: usize) -> (JsonString, usize) {
    let mut value = String::new();
    let mut pieces = Vec::new();
    let mut index = start + 1;
    let bytes = raw.as_bytes();
    while bytes[index] != b'"' {
        let decoded = value.len();
        let end = if bytes[index] == b'\\' {
            let end = if bytes[index + 1] == b'u' {
                let unit = u16::from_str_radix(&raw[index + 2..index + 6], 16).unwrap();
                index
                    + if (0xd800..=0xdbff).contains(&unit) {
                        12
                    } else {
                        6
                    }
            } else {
                index + 2
            };
            let fragment: String =
                serde_json::from_str(&format!("\"{}\"", &raw[index..end])).unwrap();
            value.push_str(&fragment);
            end
        } else {
            let scalar = raw[index..].chars().next().unwrap();
            value.push(scalar);
            index + scalar.len_utf8()
        };
        pieces.push((decoded..value.len(), index..end));
        index = end;
    }
    (JsonString { value, pieces }, index + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_objects_preserve_raw_escapes_and_reject_ambiguous_members() {
        let input = r#"{"value":"\uD83D\uDCE8\u00C9e\u0301\\u00C9"}"#;
        let fields = parse(input).unwrap();
        let value = &fields["value"];
        assert_eq!(value.value, "📨Ée\u{301}\\u00C9");
        let range = value.raw_span(0..6).unwrap();
        assert_eq!(&input[range.clone()], "\\uD83D\\uDCE8\\u00C9");
        assert_eq!(value.decoded_span(range.clone()), Some(0..6));
        assert!(value.decoded_span(range.start + 6..range.end).is_none());
        assert!(parse(r#"{"x":"\uDEAD"}"#).is_err());
        assert!(parse(r#"{"x":"1","\u0078":"2"}"#).is_err());
    }
}
