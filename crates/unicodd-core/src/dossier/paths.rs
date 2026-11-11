use serde::Serialize;

use crate::{
    case_fold,
    international::{lowercase, CaseLocale},
    normalize, Form,
};

pub(super) const PATH_BUDGET: usize = 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Profile {
    Posix,
    Apfs,
    Win32,
}

pub(super) const TARGETS: [Profile; 3] = [Profile::Posix, Profile::Apfs, Profile::Win32];

impl Profile {
    pub fn parse(name: &str) -> Option<Self> {
        TARGETS.into_iter().find(|profile| profile.name() == name)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Posix => "posix-cs",
            Self::Apfs => "apfs-ci",
            Self::Win32 => "win32-compat",
        }
    }

    pub fn comparison(self) -> &'static str {
        match self {
            Self::Posix => "UTF-8 byte identity · case-sensitive · normalization-sensitive",
            Self::Apfs => "NFC 18.0 / full fold 15.1 / NFC 18.0 · spelling preserved",
            Self::Win32 => "full fold 15.1 · spelling and normalization preserved",
        }
    }

    fn key(self, component: &str) -> String {
        match self {
            Self::Posix => component.into(),
            Self::Win32 => fold(component),
            Self::Apfs => nfc(&fold(&nfc(component))),
        }
    }
}

#[derive(Clone, Copy)]
pub(super) enum Transform {
    Raw,
    Nfc,
    Lower,
    Nfkc,
    Ascii,
}

impl Transform {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "raw" => Some(Self::Raw),
            "nfc" => Some(Self::Nfc),
            "lower" => Some(Self::Lower),
            "nfkc" => Some(Self::Nfkc),
            "ascii" => Some(Self::Ascii),
            _ => None,
        }
    }

    fn apply(self, component: &str) -> String {
        match self {
            Self::Raw => component.into(),
            Self::Nfc => nfc(component),
            Self::Lower => lowercase(component, CaseLocale::Und),
            Self::Nfkc => normalize(component, Form::NFKC).expect("bounded path"),
            Self::Ascii => component
                .chars()
                .map(|scalar| if scalar.is_ascii() { scalar } else { '_' })
                .collect(),
        }
    }
}

fn nfc(text: &str) -> String {
    normalize(text, Form::NFC).expect("bounded path")
}

fn fold(text: &str) -> String {
    case_fold(text).expect("bounded path")
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct PathTrace {
    pub components: Vec<String>,
    pub transformed: Vec<String>,
    pub key: Vec<String>,
    pub issue: Option<&'static str>,
}

impl PathTrace {
    pub fn relative(&self) -> String {
        self.transformed.join("/")
    }
}

pub(super) fn resolve(profile: Profile, raw: &str, transform: Transform) -> PathTrace {
    let components = raw
        .split(|scalar| scalar == '/' || profile == Profile::Win32 && scalar == '\\')
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut trace = PathTrace {
        components,
        transformed: vec![],
        key: vec![],
        issue: None,
    };
    let result = validate_raw(raw).and_then(|_| {
        for original in &trace.components {
            let name = transform.apply(original);
            trace.transformed.push(name.clone());
            if name.contains('/') || name.matches('\\').count() > original.matches('\\').count() {
                return Err("structural-change");
            }
            validate_component(profile, &name)?;
            trace.key.push(profile.key(&name));
        }
        if trace.relative().len() > PATH_BUDGET
            || profile == Profile::Win32 && trace.relative().encode_utf16().count() > 260
        {
            return Err("path-length");
        }
        Ok(())
    });
    trace.issue = result.err();
    trace
}

fn validate_raw(raw: &str) -> Result<(), &'static str> {
    if raw.len() > PATH_BUDGET {
        return Err("path-length");
    }
    if raw.starts_with(['/', '\\'])
        || matches!(raw.as_bytes(), [letter, b':', ..] if letter.is_ascii_alphabetic())
    {
        return Err("absolute-path");
    }
    // Archive confinement considers both separators before any target-specific
    // interpretation. A backslash can still be an opaque byte on POSIX.
    for component in raw.split(['/', '\\']) {
        match component {
            "" => return Err("empty-component"),
            "." | ".." => return Err("traversal"),
            _ => {}
        }
    }
    Ok(())
}

fn validate_component(profile: Profile, component: &str) -> Result<(), &'static str> {
    if component.is_empty() {
        return Err("empty-component");
    }
    if matches!(component, "." | "..") {
        return Err("traversal");
    }
    if component.contains('\0') {
        return Err("nul-byte");
    }
    let size = if profile == Profile::Win32 {
        component.encode_utf16().count()
    } else {
        component.len()
    };
    if size > 255 {
        return Err("component-length");
    }
    if profile == Profile::Win32 {
        if component.ends_with([' ', '.']) {
            return Err("trailing-dot-space");
        }
        if component
            .chars()
            .any(|c| c <= '\u{1F}' || "<>:\"|?*".contains(c))
        {
            return Err("reserved-character");
        }
        let basename = component
            .split('.')
            .next()
            .unwrap()
            .trim_end_matches(' ')
            .to_ascii_uppercase();
        if matches!(basename.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || ["COM", "LPT"].iter().any(|prefix| {
                basename.strip_prefix(prefix).is_some_and(|suffix| {
                    matches!(
                        suffix,
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                })
            })
        {
            return Err("device-name");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comparisons_keep_the_stored_spelling_and_model_only_the_named_profiles() {
        let a = "Café/x";
        let b = "Cafe\u{301}/X";
        let path = |profile, raw| resolve(profile, raw, Transform::Raw);
        assert_ne!(path(Profile::Posix, a).key, path(Profile::Posix, b).key);
        assert_eq!(path(Profile::Apfs, a).key, path(Profile::Apfs, b).key);
        assert_eq!(path(Profile::Apfs, b).relative(), b);
        assert_ne!(path(Profile::Win32, a).key, path(Profile::Win32, b).key);
        assert_eq!(
            path(Profile::Win32, "Dir/Foo").key,
            path(Profile::Win32, "dir\\foo").key
        );
    }

    #[test]
    fn validates_before_transform_and_revalidates_the_target_components() {
        for target in TARGETS {
            assert_eq!(
                resolve(target, "../a", Transform::Ascii).issue,
                Some("traversal")
            );
            assert_eq!(
                resolve(target, "..\\a", Transform::Raw).issue,
                Some("traversal")
            );
            assert_eq!(
                resolve(target, "a／b", Transform::Nfkc).issue,
                Some("structural-change")
            );
            assert_eq!(
                resolve(target, "．．/a", Transform::Nfkc).issue,
                Some("traversal")
            );
        }
        assert_eq!(
            resolve(Profile::Win32, "d/COM¹.txt", Transform::Raw).issue,
            Some("device-name")
        );
        assert_eq!(
            resolve(Profile::Win32, "d/a. ", Transform::Raw).issue,
            Some("trailing-dot-space")
        );
        assert_eq!(
            resolve(Profile::Win32, "d/a:b", Transform::Raw).issue,
            Some("reserved-character")
        );
    }
}
