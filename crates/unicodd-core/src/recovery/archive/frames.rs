use serde::{Deserialize, Serialize};

use super::{
    bad_input, digest, normalize, number, option, Archive, Dispatch, EngineError, Form, Report,
    Source,
};

const MAX_CAPTURE: usize = 4096;
const MAX_FRAME: usize = 256;

#[derive(Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub(super) enum FrameSpec {
    Ack { ack: String },
    Raw { raw: Vec<u8> },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Frame {
    offset: usize,
    payload: Vec<u8>,
    digest: String,
    disposition: Disposition,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Disposition {
    Accepted {
        receipt: String,
        registration: String,
        owner: String,
        #[serde(rename = "sourceDigest")]
        source_digest: String,
    },
    Quarantined {
        offset: usize,
        length: usize,
    },
    Heartbeat,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::recovery) struct HexRow {
    offset: usize,
    bytes: Vec<u8>,
    chunk_start: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    highlight: Option<[usize; 2]>,
}

pub(super) fn ack(source: &Source) -> String {
    format!("ACK|{}|{}", source.id, source.ack_marker)
}

pub(super) fn capture(archive: &Archive, sources: &[Source]) -> Option<Vec<u8>> {
    let mut wire = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for frame in &archive.frames {
        let encoded;
        let bytes = match frame {
            FrameSpec::Ack { ack: id } => {
                let source = sources.iter().find(|source| &source.id == id)?;
                if !seen.insert(id) {
                    return None;
                }
                encoded = ack(source);
                if digest(encoded.as_bytes()) != source.ack_digest {
                    return None;
                }
                encoded.as_bytes()
            }
            FrameSpec::Raw { raw } => {
                if !raw.is_empty() && std::str::from_utf8(raw).is_ok() {
                    return None;
                }
                raw
            }
        };
        if bytes.len() > MAX_FRAME || wire.len() + 2 + bytes.len() > MAX_CAPTURE {
            return None;
        }
        wire.extend((bytes.len() as u16).to_be_bytes());
        wire.extend(bytes);
    }
    (seen.len() == sources.len()).then_some(wire)
}

pub(super) fn valid_edges(edges: &[usize], len: usize) -> bool {
    edges.len() <= 128
        && edges.iter().all(|edge| (1..len).contains(edge))
        && edges.windows(2).all(|pair| pair[0] < pair[1])
}

fn offset(input: &str, index: usize) -> Result<usize, EngineError> {
    let parsed = match input.strip_prefix("0x") {
        Some(hex) => usize::from_str_radix(hex, 16),
        None => input.parse(),
    };
    parsed
        .ok()
        .filter(|value| *value < MAX_CAPTURE)
        .ok_or_else(|| bad_input("Enter a byte offset in decimal or with a 0x prefix.", index))
}

pub(super) fn show_capture(
    archive: &Archive,
    dispatch: &Dispatch,
    start: &str,
    count: &str,
    report: &mut Report,
) -> Result<(), EngineError> {
    let start = offset(start, 0)?;
    let count = number(count, 1, 128)?;
    if start >= dispatch.capture.len() {
        report.row(
            "Capture EOF",
            [format!("{} bytes received", dispatch.capture.len())],
        );
        report.check("capture-range", false);
        return Ok(());
    }
    report.check("capture-range", true);
    let end = (start + count).min(dispatch.capture.len());
    let mut from = start;
    for edge in archive
        .chunk_edges
        .iter()
        .copied()
        .filter(|edge| (start + 1..end).contains(edge))
        .chain([end])
    {
        hexdump(
            report,
            from,
            &dispatch.capture[from..edge],
            from == 0 || archive.chunk_edges.contains(&from),
            None,
        );
        from = edge;
    }
    report.row(
        "Capture range",
        [format!(
            "{start}..{end} of {} bytes · network received",
            dispatch.capture.len()
        )],
    );
    Ok(())
}

fn hexdump(
    report: &mut Report,
    offset: usize,
    bytes: &[u8],
    chunk_start: bool,
    highlight: Option<[usize; 2]>,
) {
    for (line, bytes) in bytes.chunks(12).enumerate() {
        let offset = offset + line * 12;
        report
            .row(format!("{offset:04X}"), std::iter::empty::<&str>())
            .hex = Some(HexRow {
            offset,
            bytes: bytes.to_vec(),
            chunk_start: chunk_start && line == 0,
            highlight,
        });
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Framing {
    Be,
    Le,
    Scalars,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Decoder {
    Strict,
    Chunks,
    Replacement,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Errors {
    Quarantine,
    Stop,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Integrity {
    Raw,
    Nfc,
}

struct Options {
    framing: Framing,
    decoder: Decoder,
    errors: Errors,
    integrity: Integrity,
}

impl Options {
    const REFERENCE: Self = Self {
        framing: Framing::Be,
        decoder: Decoder::Strict,
        errors: Errors::Quarantine,
        integrity: Integrity::Raw,
    };

    fn parse(args: [&str; 4]) -> Result<Self, EngineError> {
        Ok(Self {
            framing: option(args[0], 0, "be, le, or scalars")?,
            decoder: option(args[1], 1, "strict, chunks, or replacement")?,
            errors: option(args[2], 2, "quarantine or stop")?,
            integrity: option(args[3], 3, "raw or nfc")?,
        })
    }
}

struct Framer {
    pending: Vec<u8>,
    position: usize,
    framing: Framing,
}

impl Framer {
    fn new(framing: Framing) -> Self {
        Self {
            pending: Vec::new(),
            position: 0,
            framing,
        }
    }

    fn next(&mut self) -> Result<Option<(usize, Vec<u8>)>, usize> {
        let Some(prefix) = self.pending.get(..2) else {
            return Ok(None);
        };
        let prefix = [prefix[0], prefix[1]];
        let length = match self.framing {
            Framing::Le => u16::from_le_bytes(prefix),
            _ => u16::from_be_bytes(prefix),
        } as usize;
        if length > MAX_FRAME {
            return Err(length);
        }
        let size = if matches!(self.framing, Framing::Scalars) && length != 0 {
            let payload = &self.pending[2..];
            let text = std::str::from_utf8(payload).unwrap_or_else(|error| {
                std::str::from_utf8(&payload[..error.valid_up_to()]).expect("valid prefix")
            });
            let Some((index, last)) = text.char_indices().nth(length - 1) else {
                return Ok(None);
            };
            index + last.len_utf8()
        } else {
            length
        };
        let Some(payload) = self.pending.get(2..2 + size) else {
            return Ok(None);
        };
        let payload = payload.to_vec();
        let offset = self.position;
        self.pending.drain(..2 + size);
        self.position += 2 + size;
        Ok(Some((offset, payload)))
    }
}

fn chunks(capture: &[u8], edges: &[usize], decoder: Decoder, report: &mut Report) -> Vec<Vec<u8>> {
    let mut start = 0;
    let mut chunks = Vec::new();
    for end in edges.iter().copied().chain([capture.len()]) {
        let raw = &capture[start..end];
        let decoded = if matches!(decoder, Decoder::Chunks) {
            if let Err(error) = std::str::from_utf8(raw) {
                report.row(
                    "Chunk decoding changed bytes",
                    [format!(
                        "chunk {start}..{end} · first invalid byte {}",
                        start + error.valid_up_to()
                    )],
                );
            }
            String::from_utf8_lossy(raw).into_owned().into_bytes()
        } else {
            raw.to_vec()
        };
        chunks.push(decoded);
        start = end;
    }
    if matches!(decoder, Decoder::Chunks) {
        report.check("authoritative-bytes", false);
    }
    chunks
}

fn evaluate(
    dispatch: &Dispatch,
    options: &Options,
    edges: &[usize],
    report: &mut Report,
) -> Result<Vec<Frame>, EngineError> {
    let mut framer = Framer::new(options.framing);
    let mut records = Vec::new();
    let mut complete = true;
    let mut imported = std::collections::BTreeSet::new();
    let mut authentic = true;
    let mut isolation = true;
    if matches!(options.decoder, Decoder::Replacement) {
        report.check("authoritative-bytes", false);
    }
    let sources = &dispatch.release.outbox;
    let capture = chunks(&dispatch.capture, edges, options.decoder, report);
    'stream: for chunk in capture {
        framer.pending.extend(chunk);
        loop {
            let (offset, payload) = match framer.next() {
                Ok(Some(frame)) => frame,
                Ok(None) => break,
                Err(length) => {
                    report.row(
                        "Frame length rejected",
                        [format!(
                            "offset {} · {length} bytes exceeds {MAX_FRAME}",
                            framer.position
                        )],
                    );
                    complete = false;
                    break 'stream;
                }
            };
            let payload_offset = offset + 2;
            let hash = digest(&payload);
            report.row(
                "Frame",
                [
                    format!(
                        "prefix @{offset} · payload @{payload_offset} · {} bytes",
                        payload.len()
                    ),
                    hash.clone(),
                ],
            );
            let mut highlight = None;
            let disposition = match std::str::from_utf8(&payload) {
                Ok("") => {
                    report.row("Heartbeat", ["zero-length frame"]);
                    Disposition::Heartbeat
                }
                Ok(text) => {
                    let row = report.row("UTF-8", [text]);
                    row.inspect.push(text.into());
                    let evidence_hash = match options.integrity {
                        Integrity::Raw => hash.clone(),
                        Integrity::Nfc => digest(normalize(text, Form::NFC)?.as_bytes()),
                    };
                    if evidence_hash != hash {
                        report.row("Digest after NFC", [&evidence_hash]);
                    }
                    let source = sources.iter().find(|source| ack(source) == text);
                    if let Some(source) = source.filter(|source| {
                        source.ack_digest == evidence_hash
                            && hash == evidence_hash
                            && imported.insert(source.id.clone())
                    }) {
                        report.row(
                            "Verified ACK",
                            [&source.id, &source.registration, &source.owner],
                        );
                        Disposition::Accepted {
                            receipt: source.id.clone(),
                            registration: source.registration.clone(),
                            owner: source.owner.clone(),
                            source_digest: source.digest.clone(),
                        }
                    } else {
                        report.row("ACK rejected", ["Original payload digest, receipt binding or single use did not match."]);
                        authentic = false;
                        break 'stream;
                    }
                }
                Err(error) => {
                    let start = error.valid_up_to();
                    let length = error.error_len().unwrap_or(payload.len() - start);
                    highlight = Some([payload_offset + start, payload_offset + start + length]);
                    report.row(
                        "Invalid UTF-8",
                        [format!(
                            "bytes {}..{} · frame resumes at {}",
                            payload_offset + start,
                            payload_offset + start + length,
                            framer.position
                        )],
                    );
                    if matches!(options.decoder, Decoder::Replacement) {
                        report.row(
                            "Diagnostic replacement",
                            [String::from_utf8_lossy(&payload)],
                        );
                    }
                    Disposition::Quarantined {
                        offset: payload_offset + start,
                        length,
                    }
                }
            };
            hexdump(report, payload_offset, &payload, false, highlight);
            let malformed = matches!(disposition, Disposition::Quarantined { .. });
            records.push(Frame {
                offset,
                payload,
                digest: hash,
                disposition,
            });
            if malformed && matches!(options.errors, Errors::Stop) {
                report.row(
                    "Stopped at malformed frame",
                    ["Later frames have not been evaluated."],
                );
                isolation = false;
                break 'stream;
            }
        }
    }
    if complete
        && authentic
        && isolation
        && (framer.position != dispatch.capture.len() || !framer.pending.is_empty())
    {
        complete = false;
        report.row(
            "Incomplete at EOF",
            [format!(
                "offset {} · {} buffered bytes",
                framer.position,
                framer.pending.len()
            )],
        );
    }
    report.check(
        "complete-framing",
        complete && framer.position == dispatch.capture.len(),
    );
    report.check("isolated-errors", isolation);
    report.check(
        "ack-integrity",
        authentic && imported.len() == sources.len(),
    );
    Ok(records)
}

pub(super) fn ingest(
    archive: &Archive,
    dispatch: &Dispatch,
    args: [&str; 5],
    report: &mut Report,
) -> Result<Vec<Frame>, EngineError> {
    let [framing, decoder, errors, integrity, grouping] = args;
    let options = Options::parse([framing, decoder, errors, integrity])?;
    let edges = match grouping {
        "network" => archive.chunk_edges.clone(),
        "whole" => Vec::new(),
        offsets => offsets
            .split(',')
            .map(|edge| offset(edge, 4))
            .collect::<Result<Vec<_>, _>>()?,
    };
    if !valid_edges(&edges, dispatch.capture.len()) {
        return Err(bad_input(
            "Chunk offsets must be increasing interior byte offsets.",
            4,
        ));
    }
    evaluate(dispatch, &options, &edges, report)
}

pub(super) fn valid_ingestion(dispatch: &Dispatch, recorded: &[Frame]) -> bool {
    let mut report = Report::new(Default::default(), super::Operation::Deframe);
    evaluate(dispatch, &Options::REFERENCE, &[], &mut report)
        .is_ok_and(|frames| report.solved && frames == recorded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recovery::{archive::Release, Operation};

    #[test]
    fn framing_waits_for_prefix_and_payload_and_keeps_next_frame() {
        let mut framer = Framer::new(Framing::Be);
        for byte in [0, 3, 0xe2, 0x9c] {
            framer.pending.push(byte);
            assert_eq!(framer.next(), Ok(None));
        }
        framer
            .pending
            .extend([0x93, 0, 0, 0, 2, 0xc0, 0xaf, 0, 1, b'Q']);
        assert_eq!(framer.next(), Ok(Some((0, vec![0xe2, 0x9c, 0x93]))));
        assert_eq!(framer.next(), Ok(Some((5, vec![]))));
        assert_eq!(framer.next(), Ok(Some((7, vec![0xc0, 0xaf]))));
        assert_eq!(framer.next(), Ok(Some((11, vec![b'Q']))));
        assert_eq!(framer.next(), Ok(None));
    }

    #[test]
    fn framing_bounds_and_utf8_error_lengths() {
        let mut framer = Framer::new(Framing::Be);
        framer.pending.extend([1, 1]);
        assert_eq!(framer.next(), Err(257));
        for (bytes, length) in [
            (&[0xc0, 0xaf][..], Some(1)),
            (&[0xe2, 0x82, b'X'], Some(2)),
            (&[0xe2, 0x82], None),
            (&[0xed, 0xa0, 0x80], Some(1)),
            (&[0xf4, 0x90, 0x80, 0x80], Some(1)),
            (&[0x80], Some(1)),
        ] {
            let error = std::str::from_utf8(bytes).unwrap_err();
            assert_eq!(error.valid_up_to(), 0);
            assert_eq!(error.error_len(), length);
        }
    }

    #[test]
    fn eof_reports_partial_headers_and_payloads_without_resync() {
        for capture in [vec![0], vec![0, 3, b'A']] {
            let dispatch = Dispatch {
                capture_digest: digest(&capture),
                capture,
                release: Release {
                    identities: vec![],
                    outbox: vec![],
                },
                routes: vec![],
            };
            let mut report = Report::new(Default::default(), Operation::Deframe);
            let frames = evaluate(&dispatch, &Options::REFERENCE, &[], &mut report).unwrap();
            assert!(frames.is_empty());
            assert!(!report.solved);
            assert!(report
                .rows
                .iter()
                .any(|row| row.label == "Incomplete at EOF"));
            assert!(
                !report
                    .checks
                    .iter()
                    .find(|check| check.id == "complete-framing")
                    .unwrap()
                    .passed
            );
        }
    }
}
