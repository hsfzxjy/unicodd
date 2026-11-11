use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Sample {
    id: String,
    prefix: String,
    text: String,
    suffix: String,
    minimum_clusters: usize,
    capacity: usize,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Units {
    Utf16,
    Scalar,
    Grapheme,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum Bidi {
    Raw,
    Isolate,
    IsolateFirst,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Controls {
    Raw,
    Escape,
    Reject,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Options {
    units: Units,
    count: usize,
    bidi: Bidi,
    controls: Controls,
}

impl Options {
    pub(super) fn parse(
        units: &str,
        count: &str,
        bidi: &str,
        controls: &str,
    ) -> Result<Self, EngineError> {
        Ok(Self {
            units: option(units, 0, "utf16, scalar, or grapheme")?,
            count: number(count, 1, 64)?,
            bidi: option(bidi, 2, "raw, isolate, or isolate-first")?,
            controls: option(controls, 3, "raw, escape, or reject")?,
        })
    }
}

pub(super) fn validate_samples(samples: &[Sample]) -> Result<(), EngineError> {
    if samples.is_empty()
        || samples.len() > 32
        || !distinct(samples.iter().map(|s| s.id.as_str()))
        || !samples.iter().all(|s| {
            identifier(&s.id)
                && !s.prefix.is_empty()
                && !s.suffix.is_empty()
                && s.prefix.len() + s.suffix.len() <= 256
                && [&s.prefix, &s.suffix]
                    .into_iter()
                    .all(|text| text.is_ascii() && !text.chars().any(is_formatting_control))
                && s.text.len() <= 1024
                && (1..=grapheme_count(&s.text)).contains(&s.minimum_clusters)
                && (1..=2048).contains(&s.capacity)
        })
    {
        return Err(invalid(
            "Invalid audit sample, cluster minimum, or byte limit.",
        ));
    }
    Ok(())
}

fn truncation(text: &str, options: Options) -> Result<String, std::string::FromUtf16Error> {
    match options.units {
        Units::Utf16 => {
            String::from_utf16(&text.encode_utf16().take(options.count).collect::<Vec<_>>())
        }
        Units::Scalar => Ok(text.chars().take(options.count).collect()),
        Units::Grapheme => Ok(truncate_graphemes(text, options.count).into()),
    }
}

pub(super) fn preview(samples: &[Sample], options: Options, report: &mut Report, verbose: bool) {
    let mut valid_encoding = true;
    let mut intact = true;
    let mut within_capacity = true;
    let mut isolated = true;
    let mut safe_controls = true;
    for sample in samples {
        let wrapped = isolate(&sample.text);
        let source = if options.bidi == Bidi::IsolateFirst {
            &wrapped
        } else {
            &sample.text
        };
        let Ok(truncated) = truncation(source, options) else {
            valid_encoding = false;
            report.row(&sample.id, ["UTF-16 cut left an unpaired surrogate"]);
            continue;
        };
        let display = if options.bidi == Bidi::IsolateFirst {
            truncated
                .trim_start_matches('\u{2068}')
                .trim_end_matches('\u{2069}')
        } else {
            &truncated
        };
        // Check the boundary against the original field, before any display escaping.
        let boundary = sample.text.starts_with(display)
            && grapheme_boundaries(&sample.text).any(|offset| offset == display.len());
        let enough = grapheme_count(display) >= sample.minimum_clusters;
        let controls = sample.text.chars().any(is_formatting_control);
        let allowed = !controls || options.controls == Controls::Escape;
        let rendered = if options.controls == Controls::Escape {
            escape_controls(display)
        } else {
            display.into()
        };
        let field = match options.bidi {
            Bidi::Raw => rendered.clone(),
            Bidi::Isolate => isolate(&rendered),
            Bidi::IsolateFirst => truncated.clone(),
        };
        let positioned = field_stays_between(&sample.prefix, &field, &sample.suffix);
        let safe_order = positioned && field == isolate(&rendered);
        let line = format!("{}{field}{}", sample.prefix, sample.suffix);
        let fits = line.len() <= sample.capacity;
        intact &= boundary && enough;
        within_capacity &= fits;
        isolated &= safe_order;
        safe_controls &= allowed;
        let mut notes = vec![format!("{}/{} UTF-8 bytes", line.len(), sample.capacity)];
        if !boundary {
            notes.push("cut inside a grapheme cluster".into());
        }
        if !enough {
            notes.push(format!(
                "requires {} complete clusters",
                sample.minimum_clusters
            ));
        }
        if !positioned {
            notes.push("field crosses a fixed label or number".into());
        }
        if options.bidi == Bidi::IsolateFirst {
            notes.push("isolation applied before truncation".into());
        }
        if controls {
            notes.push(
                match options.controls {
                    Controls::Escape => "explicit formatting escaped",
                    Controls::Reject => "field rejected by control policy",
                    Controls::Raw => "explicit formatting left active",
                }
                .into(),
            );
        }
        let passed = boundary && enough && safe_order && fits && allowed;
        if verbose || !passed {
            if options.controls != Controls::Reject || !controls {
                let row = report.row(&sample.id, [&sample.prefix, &rendered, &sample.suffix]);
                row.audit = true;
                row.details = notes;
                if passed {
                    row.serialized = Some(line);
                }
            } else {
                report.row(&sample.id, notes);
            }
        }
    }
    report.check("valid-encoding", valid_encoding);
    report.check("grapheme-boundary", intact);
    report.check("byte-capacity", within_capacity);
    report.check("bidi-isolation", isolated);
    report.check("formatting-controls", safe_controls);
}
