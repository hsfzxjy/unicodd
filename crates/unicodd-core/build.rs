use std::{env, fs, path::PathBuf};

const DATA: &str = "data/15.1.0";

fn source(file: &str, version_marker: &str) -> String {
    let path = format!("{DATA}/{file}");
    println!("cargo:rerun-if-changed={path}");
    let text = fs::read_to_string(path).expect("read vendored Unicode data");
    assert!(text
        .lines()
        .take(10)
        .any(|line| line.contains(version_marker)));
    text
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
}
