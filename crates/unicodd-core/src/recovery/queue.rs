use super::*;

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Strategy {
    Title,
    Composite,
    Inclusive,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cursor {
    profile: String,
    revision: String,
    locale: SortLocale,
    strength: SortStrength,
    strategy: Strategy,
    page_size: usize,
    key: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    record: Option<String>,
}

pub(super) fn validate_cursors(data: &Dataset) -> Result<(), EngineError> {
    if data.cursors.len() > 16
        || !data.cursors.iter().all(|(id, cursor)| {
            identifier(id)
                && id != "start"
                && identifier(&cursor.profile)
                && identifier(&cursor.revision)
                && (1..=64).contains(&cursor.page_size)
                && cursor.key.len() <= 8192
                && if cursor.strategy == Strategy::Title {
                    cursor.record.is_none()
                } else {
                    cursor
                        .record
                        .as_ref()
                        .is_some_and(|id| data.appeals.iter().any(|a| a.id == *id))
                }
        })
    {
        return Err(invalid("Invalid queue cursor reference."));
    }
    Ok(())
}

pub(super) fn locale(text: &str) -> Result<SortLocale, EngineError> {
    option(text, 0, "en-US or sv-SE")
}

pub(super) fn strength(text: &str) -> Result<SortStrength, EngineError> {
    option(text, 1, "primary, secondary, or tertiary")
}

pub(super) fn replay(
    data: &Dataset,
    locale: SortLocale,
    strength: SortStrength,
    strategy: &str,
    size: &str,
    start: &str,
    report: &mut Report,
) -> Result<(), EngineError> {
    let strategy = option(strategy, 2, "title, composite, or inclusive")?;
    let size = number(size, 3, 64)?;
    let contract = Cursor {
        profile: COLLATION_PROFILE.into(),
        revision: data.revision.clone(),
        locale,
        strength,
        strategy,
        page_size: size,
        key: Vec::new(),
        record: None,
    };
    let collation = collator(locale, strength);
    let mut records: Vec<_> = data
        .appeals
        .iter()
        .map(|a| (sort_key(&collation, &a.title), a))
        .collect();
    // Stable ties retain snapshot order, but that order cannot make a title-only cursor unique.
    records.sort_by(|(left, a), (right, b)| {
        left.cmp(right).then_with(|| {
            if strategy == Strategy::Title {
                std::cmp::Ordering::Equal
            } else {
                a.id.cmp(&b.id)
            }
        })
    });
    let mut cursor = if start == "start" {
        None
    } else {
        let cursor = data
            .cursors
            .get(start)
            .cloned()
            .or_else(|| serde_json::from_str(start).ok())
            .ok_or_else(|| {
                bad_input(
                    "Enter start, a named cursor from the logs, or a replay cursor.",
                    4,
                )
            })?;
        let expected = Cursor {
            key: cursor.key.clone(),
            record: cursor.record.clone(),
            ..contract.clone()
        };
        let boundary_exists = records.iter().any(|(key, appeal)| {
            key == &cursor.key
                && match strategy {
                    Strategy::Title => cursor.record.is_none(),
                    _ => cursor.record.as_deref() == Some(appeal.id.as_str()),
                }
        });
        report.check("cursor-profile", cursor == expected && boundary_exists);
        if !report.solved {
            report.row("Active profile", [COLLATION_PROFILE, &data.revision]);
            return Ok(());
        }
        Some(cursor)
    };
    let mut visited = Vec::new();
    let mut seen = BTreeSet::new();
    // Each pass advances or observes a repeated record and stops. Never spin on a repeated cursor.
    for page in 1..=records.len() + 1 {
        let remaining = if let Some(cursor) = &cursor {
            records.partition_point(|(candidate, a)| match strategy {
                Strategy::Title => candidate <= &cursor.key,
                Strategy::Composite => {
                    (candidate, Some(&a.id)) <= (&cursor.key, cursor.record.as_ref())
                }
                Strategy::Inclusive => {
                    (candidate, Some(&a.id)) < (&cursor.key, cursor.record.as_ref())
                }
            })
        } else {
            0
        };
        let records = &records[remaining..records.len().min(remaining + size)];
        let Some((key, last)) = records.last() else {
            break;
        };
        cursor = Some(Cursor {
            key: key.clone(),
            record: (strategy != Strategy::Title).then(|| last.id.clone()),
            ..contract.clone()
        });
        report
            .row(format!("Page {page}"), records.iter().map(|(_, a)| &a.id))
            .serialized = Some(serde_json::to_string(&cursor).expect("serializable cursor"));
        let mut repeat = false;
        for (_, record) in records {
            repeat |= !seen.insert(record.id.as_str());
            visited.push(record.id.clone());
        }
        if repeat {
            break;
        }
    }
    let missing: Vec<_> = records
        .iter()
        .filter(|(_, a)| !seen.contains(a.id.as_str()))
        .map(|(_, a)| &a.id)
        .collect();
    if !missing.is_empty() {
        report.row("Missing records", missing.iter().copied());
    }
    report.check("no-duplicates", visited.len() == seen.len());
    report.check("complete-traversal", missing.is_empty());
    report.check(
        "cursor-unique",
        strategy != Strategy::Title || records.windows(2).all(|pair| pair[0].0 != pair[1].0),
    );
    if report.solved {
        report.context.queue = visited;
    }
    Ok(())
}
