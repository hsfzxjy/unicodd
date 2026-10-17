use icu_normalizer::DecomposingNormalizerBorrowed;
use serde::Serialize;
use std::collections::HashMap;
use std::env;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

const UNICODE_VERSION: &str = "17.0.0";

#[derive(Clone, Debug)]
struct UcdProperties {
    general_category: String,
    canonical_combining_class: u8,
    uppercase: Option<u32>,
    lowercase: Option<u32>,
    titlecase: Option<u32>,
}

#[derive(Debug)]
struct PropertyRange {
    start: u32,
    end: u32,
    value: String,
}

#[derive(Serialize)]
struct RelationshipIndex {
    unicode_version: &'static str,
    uts39_version: &'static str,
    properties: Vec<PropertyRangeRecord>,
    records: Vec<RelationshipRecord>,
    confusables: Vec<SequenceMapping>,
}

#[derive(Serialize)]
struct NameIndex {
    unicode_version: &'static str,
    names: Vec<(u32, String)>,
}

#[derive(Serialize)]
struct PropertyRangeRecord(u32, u32, String, u8, String, String);

#[derive(Serialize)]
struct RelationshipRecord {
    cp: u32,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    nfd: Vec<u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    nfkd: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    upper: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lower: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    fold: Vec<u32>,
}

#[derive(Serialize)]
struct SequenceMapping {
    source: Vec<u32>,
    target: Vec<u32>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = env::args_os().skip(1);
    let input_directory = arguments
        .next()
        .map(PathBuf::from)
        .ok_or("usage: unicode-indexer <Unicode data directory> <output directory>")?;
    let output_directory = arguments
        .next()
        .map(PathBuf::from)
        .ok_or("usage: unicode-indexer <Unicode data directory> <output directory>")?;
    if arguments.next().is_some() {
        return Err("unicode-indexer accepts exactly two arguments".into());
    }

    let ucd = parse_unicode_data(&input_directory.join("UnicodeData.txt"))?;
    let scripts = parse_property_ranges(&input_directory.join("Scripts.txt"))?;
    let ages = parse_property_ranges(&input_directory.join("DerivedAge.txt"))?;
    let case_folds = parse_case_folding(&input_directory.join("CaseFolding.txt"))?;
    let confusables = parse_confusables(&input_directory.join("confusables.txt"))?;

    let nfd = DecomposingNormalizerBorrowed::new_nfd();
    let nfkd = DecomposingNormalizerBorrowed::new_nfkd();
    let mut records = Vec::new();
    let mut names = Vec::new();

    for scalar in 0..=0x10ffff {
        let Some(character) = char::from_u32(scalar) else {
            continue;
        };
        let Some(name) = unicode_names2::name(character) else {
            continue;
        };

        names.push((scalar, name.to_string()));
        let properties = ucd.get(&scalar);
        let source = character.to_string();
        let canonical: Vec<u32> = nfd.normalize(&source).chars().map(u32::from).collect();
        let compatibility: Vec<u32> = nfkd.normalize(&source).chars().map(u32::from).collect();
        let canonical_changed = canonical.as_slice() != [scalar];
        let compatibility_changed = compatibility != canonical;
        let record = RelationshipRecord {
            cp: scalar,
            nfd: if canonical_changed {
                canonical
            } else {
                Vec::new()
            },
            nfkd: if compatibility_changed {
                compatibility
            } else {
                Vec::new()
            },
            upper: properties.and_then(|value| value.uppercase),
            lower: properties.and_then(|value| value.lowercase),
            title: properties.and_then(|value| value.titlecase),
            fold: case_folds.get(&scalar).cloned().unwrap_or_default(),
        };
        if record.has_relationship() {
            records.push(record);
        }
    }

    let relationship_index = RelationshipIndex {
        unicode_version: UNICODE_VERSION,
        uts39_version: UNICODE_VERSION,
        properties: build_property_ranges(&ucd, &scripts, &ages),
        records,
        confusables,
    };
    let name_index = NameIndex {
        unicode_version: UNICODE_VERSION,
        names,
    };
    fs::create_dir_all(&output_directory)?;
    write_json(
        &output_directory.join("relationships-17.0.0.json"),
        &relationship_index,
    )?;
    write_json(&output_directory.join("names-17.0.0.json"), &name_index)?;
    println!("Unicode indexes ready: {}", output_directory.display());
    Ok(())
}

impl RelationshipRecord {
    fn has_relationship(&self) -> bool {
        !self.nfd.is_empty()
            || !self.nfkd.is_empty()
            || self.upper.is_some()
            || self.lower.is_some()
            || self.title.is_some()
            || !self.fold.is_empty()
    }
}

fn write_json<T: Serialize>(
    output_path: &Path,
    value: &T,
) -> Result<(), Box<dyn std::error::Error>> {
    let file = File::create(output_path)?;
    let mut writer = BufWriter::new(file);
    serde_json::to_writer(&mut writer, value)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

fn build_property_ranges(
    ucd: &HashMap<u32, UcdProperties>,
    scripts: &[PropertyRange],
    ages: &[PropertyRange],
) -> Vec<PropertyRangeRecord> {
    let mut result = Vec::new();
    let mut pending: Option<PropertyRangeRecord> = None;

    for scalar in 0..=0x10ffff {
        if char::from_u32(scalar).is_none() {
            if let Some(range) = pending.take() {
                result.push(range);
            }
            continue;
        }
        let properties = ucd.get(&scalar);
        let current = PropertyRangeRecord(
            scalar,
            scalar,
            properties
                .map(|value| value.general_category.clone())
                .unwrap_or_else(|| "Cn".to_owned()),
            properties
                .map(|value| value.canonical_combining_class)
                .unwrap_or(0),
            property_at(scripts, scalar).unwrap_or("Unknown").to_owned(),
            property_at(ages, scalar).unwrap_or("Unassigned").to_owned(),
        );

        match &mut pending {
            Some(range)
                if range.1.checked_add(1) == Some(scalar)
                    && range.2 == current.2
                    && range.3 == current.3
                    && range.4 == current.4
                    && range.5 == current.5 =>
            {
                range.1 = scalar;
            }
            Some(_) => {
                result.push(pending.replace(current).expect("pending range exists"));
            }
            None => pending = Some(current),
        }
    }
    if let Some(range) = pending {
        result.push(range);
    }
    result
}

fn parse_unicode_data(
    path: &Path,
) -> Result<HashMap<u32, UcdProperties>, Box<dyn std::error::Error>> {
    let contents = fs::read_to_string(path)?;
    let mut result = HashMap::new();
    let mut pending_range: Option<(u32, UcdProperties)> = None;

    for line in contents.lines() {
        let fields: Vec<&str> = line.split(';').collect();
        if fields.len() != 15 {
            return Err(format!("invalid UnicodeData row: {line}").into());
        }
        let scalar = u32::from_str_radix(fields[0], 16)?;
        let properties = UcdProperties {
            general_category: fields[2].to_owned(),
            canonical_combining_class: fields[3].parse()?,
            uppercase: parse_optional_scalar(fields[12])?,
            lowercase: parse_optional_scalar(fields[13])?,
            titlecase: parse_optional_scalar(fields[14])?,
        };

        if fields[1].ends_with(", First>") {
            pending_range = Some((scalar, properties));
        } else if fields[1].ends_with(", Last>") {
            let (start, range_properties) = pending_range
                .take()
                .ok_or("UnicodeData range end without a matching start")?;
            for range_scalar in start..=scalar {
                result.insert(range_scalar, range_properties.clone());
            }
        } else {
            result.insert(scalar, properties);
        }
    }

    if pending_range.is_some() {
        return Err("UnicodeData range start without a matching end".into());
    }
    Ok(result)
}

fn parse_property_ranges(path: &Path) -> Result<Vec<PropertyRange>, Box<dyn std::error::Error>> {
    let contents = fs::read_to_string(path)?;
    let mut ranges = Vec::new();
    for line in contents.lines() {
        let data = line.split('#').next().unwrap_or_default().trim();
        if data.is_empty() {
            continue;
        }
        let (range, value) = data
            .split_once(';')
            .ok_or_else(|| format!("invalid property row: {line}"))?;
        let (start, end) = parse_range(range.trim())?;
        ranges.push(PropertyRange {
            start,
            end,
            value: value.trim().to_owned(),
        });
    }
    ranges.sort_by_key(|range| range.start);
    Ok(ranges)
}

fn parse_case_folding(path: &Path) -> Result<HashMap<u32, Vec<u32>>, Box<dyn std::error::Error>> {
    let contents = fs::read_to_string(path)?;
    let mut simple = HashMap::new();
    let mut full = HashMap::new();
    for line in contents.lines() {
        let data = line.split('#').next().unwrap_or_default().trim();
        if data.is_empty() {
            continue;
        }
        let fields: Vec<&str> = data.split(';').map(str::trim).collect();
        if fields.len() < 3 || fields[1] == "T" {
            continue;
        }
        let scalar = u32::from_str_radix(fields[0], 16)?;
        let mapping = parse_sequence(fields[2])?;
        if fields[1] == "F" {
            full.insert(scalar, mapping);
        } else if fields[1] == "C" || fields[1] == "S" {
            simple.insert(scalar, mapping);
        }
    }
    simple.extend(full);
    Ok(simple)
}

fn parse_confusables(path: &Path) -> Result<Vec<SequenceMapping>, Box<dyn std::error::Error>> {
    let contents = fs::read_to_string(path)?;
    let mut mappings = Vec::new();
    for line in contents.lines() {
        let data = line.split('#').next().unwrap_or_default().trim();
        if data.is_empty() {
            continue;
        }
        let fields: Vec<&str> = data.split(';').map(str::trim).collect();
        if fields.len() < 2 {
            return Err(format!("invalid confusables row: {line}").into());
        }
        mappings.push(SequenceMapping {
            source: parse_sequence(fields[0])?,
            target: parse_sequence(fields[1])?,
        });
    }
    Ok(mappings)
}

fn parse_range(value: &str) -> Result<(u32, u32), Box<dyn std::error::Error>> {
    if let Some((start, end)) = value.split_once("..") {
        Ok((
            u32::from_str_radix(start, 16)?,
            u32::from_str_radix(end, 16)?,
        ))
    } else {
        let scalar = u32::from_str_radix(value, 16)?;
        Ok((scalar, scalar))
    }
}

fn parse_optional_scalar(value: &str) -> Result<Option<u32>, Box<dyn std::error::Error>> {
    if value.is_empty() {
        Ok(None)
    } else {
        Ok(Some(u32::from_str_radix(value, 16)?))
    }
}

fn parse_sequence(value: &str) -> Result<Vec<u32>, Box<dyn std::error::Error>> {
    value
        .split_whitespace()
        .map(|scalar| u32::from_str_radix(scalar, 16).map_err(Into::into))
        .collect()
}

fn property_at(ranges: &[PropertyRange], scalar: u32) -> Option<&str> {
    let index = ranges.partition_point(|range| range.start <= scalar);
    index
        .checked_sub(1)
        .and_then(|candidate| ranges.get(candidate))
        .filter(|range| scalar <= range.end)
        .map(|range| range.value.as_str())
}
