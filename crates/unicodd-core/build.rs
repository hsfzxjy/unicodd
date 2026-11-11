use std::{env, fs, path::PathBuf};

const DATA: &str = "data/15.1.0";

fn source_at(directory: &str, file: &str, version_marker: &str) -> String {
    let path = format!("{directory}/{file}");
    println!("cargo:rerun-if-changed={path}");
    let text = fs::read_to_string(path).expect("read vendored Unicode data");
    assert!(text
        .lines()
        .take(10)
        .any(|line| line.contains(version_marker)));
    text
}

fn source(file: &str, version_marker: &str) -> String {
    source_at(DATA, file, version_marker)
}

fn records(text: &str) -> impl Iterator<Item = Vec<&str>> {
    text.lines().filter_map(|line| {
        let fields = line.split('#').next().unwrap().trim();
        (!fields.is_empty()).then(|| fields.split(';').map(str::trim).collect())
    })
}

fn scalar(hex: &str) -> char {
    char::from_u32(u32::from_str_radix(hex, 16).unwrap()).unwrap()
}

fn range(field: &str) -> (u32, u32) {
    let (first, last) = field.split_once("..").unwrap_or((field, field));
    (
        u32::from_str_radix(first, 16).unwrap(),
        u32::from_str_radix(last, 16).unwrap(),
    )
}

fn table<T: std::fmt::Debug>(
    output: &mut String,
    name: &str,
    ty: &str,
    rows: impl IntoIterator<Item = T>,
) {
    use std::fmt::Write;
    writeln!(output, "pub(super) static {name}: &[{ty}] = &[").unwrap();
    for row in rows {
        writeln!(output, "    {row:?},").unwrap();
    }
    output.push_str("];\n");
}

fn identifier_tables(output: &mut String, version: &str, suffix: &str, core: &str) {
    let directory = format!("data/{version}");
    for property in ["XID_Start", "XID_Continue"] {
        let mut ranges: Vec<_> = records(core)
            .filter(|fields| fields[1] == property)
            .map(|fields| range(fields[0]))
            .collect();
        ranges.sort_unstable();
        assert!(!ranges.is_empty() && ranges.windows(2).all(|pair| pair[0].1 < pair[1].0));
        table(
            output,
            &format!("{}_{suffix}", property.to_uppercase()),
            "(u32, u32)",
            ranges,
        );
    }
    let categories = source_at(
        &directory,
        "DerivedGeneralCategory.txt",
        &format!("DerivedGeneralCategory-{version}.txt"),
    );
    let mut ranges: Vec<_> = records(&categories)
        .filter(|fields| fields[1] != "Cn")
        .map(|fields| {
            let (first, last) = range(fields[0]);
            (first, last, fields[1])
        })
        .collect();
    ranges.sort_unstable();
    assert!(!ranges.is_empty() && ranges.windows(2).all(|pair| pair[0].1 < pair[1].0));
    table(
        output,
        &format!("CATEGORY_{suffix}"),
        "(u32, u32, &str)",
        ranges,
    );
}

fn main() {
    let confusables = source("confusables.txt", "Version: 15.1.0");
    let fold = source("CaseFolding.txt", "CaseFolding-15.1.0.txt");
    let core = source(
        "DerivedCoreProperties.txt",
        "DerivedCoreProperties-15.1.0.txt",
    );
    let scripts = source("Scripts.txt", "Scripts-15.1.0.txt");

    let mut confusables: Vec<_> = records(&confusables)
        .map(|fields| {
            assert_eq!(fields[2], "MA");
            let prototype: String = fields[1].split_whitespace().map(scalar).collect();
            (scalar(fields[0]), prototype)
        })
        .collect();
    let mut fold: Vec<_> = records(&fold)
        .filter(|fields| matches!(fields[1], "C" | "F"))
        .map(|fields| {
            let mapping: String = fields[2].split_whitespace().map(scalar).collect();
            (scalar(fields[0]), mapping)
        })
        .collect();
    let mut ignorable: Vec<_> = records(&core)
        .filter(|fields| fields[1] == "Default_Ignorable_Code_Point")
        .map(|fields| range(fields[0]))
        .collect();
    let mut scripts: Vec<_> = records(&scripts)
        .map(|fields| {
            let (first, last) = range(fields[0]);
            (first, last, fields[1])
        })
        .collect();
    confusables.sort_unstable();
    fold.sort_unstable();
    ignorable.sort_unstable();
    scripts.sort_unstable();
    assert_eq!(confusables.len(), 6311);
    assert_eq!(fold.len(), 1530);
    assert!(confusables.windows(2).all(|pair| pair[0].0 < pair[1].0));
    assert!(fold.windows(2).all(|pair| pair[0].0 < pair[1].0));

    let mut output = String::new();
    table(&mut output, "CONFUSABLES", "(char, &str)", confusables);
    table(&mut output, "CASE_FOLD", "(char, &str)", fold);
    table(&mut output, "IGNORABLE", "(u32, u32)", ignorable);
    table(&mut output, "SCRIPTS", "(u32, u32, &str)", scripts);
    let dest = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("unicode_security.rs");
    fs::write(dest, output).expect("write Unicode tables");

    let mut output = String::new();
    identifier_tables(&mut output, "15.1.0", "LEGACY", &core);
    let modern_core = source_at(
        "data/18.0.0",
        "DerivedCoreProperties.txt",
        "DerivedCoreProperties-18.0.0.txt",
    );
    identifier_tables(&mut output, "18.0.0", "MODERN", &modern_core);
    let modern_fold = source_at("data/18.0.0", "CaseFolding.txt", "CaseFolding-18.0.0.txt");
    let mut mappings: Vec<_> = records(&modern_fold)
        .filter(|fields| matches!(fields[1], "C" | "F"))
        .map(|fields| {
            let mapped: String = fields[2].split_whitespace().map(scalar).collect();
            (scalar(fields[0]), mapped)
        })
        .collect();
    mappings.sort_unstable();
    assert!(!mappings.is_empty() && mappings.windows(2).all(|pair| pair[0].0 < pair[1].0));
    table(&mut output, "CASE_FOLD_MODERN", "(char, &str)", mappings);
    let dest = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("unicode_identifiers.rs");
    fs::write(dest, output).expect("write versioned identifier tables");
}
