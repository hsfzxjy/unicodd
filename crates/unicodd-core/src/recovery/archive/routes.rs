use icu_normalizer::uts46::Uts46Mapper;
use idna::uts46::{AsciiDenyList, DnsLength, Hyphens, Uts46};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};

use super::{inspect_non_ascii, Archive, Report, Source};

pub(super) const PROFILE: &str = "UTS #46 · Unicode 15.1 · STD3 / Bidi / ContextJ";

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(super) enum Profile {
    Transitional,
    Nontransitional,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Endpoint {
    pub id: String,
    pub host: String,
    pub owner: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct Route {
    pub receipt: String,
    pub endpoint: String,
    pub host: String,
    pub path: String,
    pub status: u16,
}

// The virtual gateway accepts absolute HTTPS IRIs with DNS authorities, no userinfo,
// port other than 443, query, or fragment. Path segments use exact decoded UTF-8.
// Escaped separators and dot segments are outside this archive resource protocol.
fn decode(text: &str) -> Result<String, &'static str> {
    for (index, _) in text.match_indices('%') {
        if !text
            .as_bytes()
            .get(index + 1..index + 3)
            .is_some_and(|hex| hex.iter().all(u8::is_ascii_hexdigit))
        {
            return Err("Incomplete or invalid percent escape.");
        }
    }
    percent_decode_str(text)
        .decode_utf8()
        .map(|value| value.into_owned())
        .map_err(|_| "Percent escapes must decode to strict UTF-8.")
}

fn parse(url: &str) -> Result<(&str, String, &str), &'static str> {
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) || url.contains(['?', '#', '\\']) {
        return Err(
            "Whitespace, control characters, queries and fragments are outside this URL profile.",
        );
    }
    let (scheme, rest) = url
        .split_once("://")
        .ok_or("Supply an absolute HTTPS URL.")?;
    if !scheme.eq_ignore_ascii_case("https") {
        return Err("Only HTTPS is enabled in this gateway profile.");
    }
    let path_start = rest.find('/').unwrap_or(rest.len());
    let (authority, path) = rest.split_at(path_start);
    let host = authority.strip_suffix(":443").unwrap_or(authority);
    let host = decode(host)?;
    if host.is_empty() || host.contains(['@', ':', '[', ']', '/', '\\', '?', '#', '%']) {
        return Err("Use a DNS host and optional default port, without credentials.");
    }
    Ok((authority, host, if path.is_empty() { "/" } else { path }))
}

fn resource_path(path: &str) -> Result<String, &'static str> {
    let parts = path
        .split('/')
        .map(|part| {
            let part = decode(part)?;
            if matches!(part.as_str(), "." | "..")
                || part.contains(['/', '\\'])
                || part.chars().any(char::is_control)
            {
                return Err(
                    "A resource segment cannot contain a dot segment, separator, or control.",
                );
            }
            Ok(part)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(parts.join("/"))
}

fn transitional(host: &str) -> String {
    // UTS #46 §4: apply the historical deviation mappings before mapping/NFC.
    // A-labels remain ASCII here and are decoded and validated by UTS #46 itself.
    let mut result = String::with_capacity(host.len());
    for scalar in host.chars() {
        match scalar {
            'ß' | 'ẞ' => result.push_str("ss"),
            'ς' => result.push('σ'),
            '\u{200C}' | '\u{200D}' => {}
            other => result.push(other),
        }
    }
    result
}

fn ascii(host: &str) -> Result<String, idna::Errors> {
    Uts46::new()
        .to_ascii(
            host.as_bytes(),
            AsciiDenyList::STD3,
            Hyphens::Check,
            DnsLength::VerifyAllowRootDot,
        )
        .map(|result| result.trim_end_matches('.').to_owned())
}

pub(super) fn canonical_host(host: &str) -> bool {
    host.ends_with(".test") && ascii(host).is_ok_and(|mapped| host == mapped)
}

pub(super) fn canonical_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.contains(['?', '#', '%'])
        && resource_path(path).is_ok_and(|decoded| decoded == path)
}

pub(super) fn authorized(archive: &Archive, source: &Source, route: &Route) -> bool {
    route.receipt == source.id
        && route.endpoint == source.endpoint
        && route.path == source.path
        && route.status == 202
        && archive.endpoints.iter().any(|endpoint| {
            endpoint.id == source.endpoint
                && endpoint.host == route.host
                && endpoint.owner == source.owner
        })
}

pub(super) fn resolve(
    archive: &Archive,
    receipt: &str,
    url: &str,
    profile: Profile,
    report: &mut Report,
) -> Option<Route> {
    let (authority, host, path) = match parse(url) {
        Ok(parsed) => parsed,
        Err(reason) => {
            report.row("URL rejected", [reason]);
            return None;
        }
    };
    report.row("Authority", [authority]);
    inspect_non_ascii(report.row("Parsed host", [&host]), &host);
    report.row("Raw path", [path]);
    let path = match resource_path(path) {
        Ok(value) => value,
        Err(reason) => {
            report.row("Path rejected", [reason]);
            return None;
        }
    };
    inspect_non_ascii(report.row("Resource path", [&path]), &path);
    let input = match profile {
        Profile::Nontransitional => host,
        Profile::Transitional => transitional(&host),
    };
    report.row(
        "Host profile",
        [
            PROFILE,
            if profile == Profile::Transitional {
                "transitional (historical)"
            } else {
                "nontransitional"
            },
        ],
    );
    let mapper = Uts46Mapper::new();
    let mapped: String = mapper.map_normalize(input.chars()).collect();
    report.row("Mapped host", [&mapped]);
    let Ok(host) = ascii(&input) else {
        report.row("IDNA rejected", [if mapped.contains(['\u{200C}', '\u{200D}']) {
            "Label validation failed. Joiners require a valid ContextJ sequence."
        } else if mapped.split('.').any(|label| label.starts_with("xn--")) {
            "A-label validation failed. Check Punycode, round-trip, and label rules."
        } else {
            "Label validation failed. Check empty labels, hyphens, disallowed scalars, Bidi and DNS length."
        }]);
        return None;
    };
    let uts = Uts46::new();
    let (unicode, valid) = uts.to_unicode(host.as_bytes(), AsciiDenyList::STD3, Hyphens::Check);
    if valid.is_err() || !ascii(&unicode).is_ok_and(|round_trip| round_trip == host) {
        report.row(
            "A-label rejected",
            ["The Unicode form does not round-trip."],
        );
        return None;
    }
    let unicode_row = report.row("Unicode host", [&unicode]);
    if unicode != mapped {
        inspect_non_ascii(unicode_row, &unicode);
    }
    report.row("A-label", [&host]);
    let Some(endpoint) = archive
        .endpoints
        .iter()
        .find(|endpoint| endpoint.host == host)
    else {
        report.row("Registry", ["No virtual endpoint for this A-label."]);
        return None;
    };
    let route = Route {
        receipt: receipt.into(),
        endpoint: endpoint.id.clone(),
        host,
        path,
        status: 202,
    };
    report.row("Virtual transport", [&endpoint.id, "202 Accepted"]);
    match archive.sources.iter().find(|source| source.id == receipt) {
        Some(source) if authorized(archive, source, &route) => {
            report.row(
                "Authorization",
                [&source.id, &source.owner, "endpoint and resource match"],
            );
        }
        Some(source) if route.endpoint != source.endpoint => {
            report.row(
                "Authorization",
                [&source.id, "endpoint is assigned to a different owner"],
            );
        }
        Some(source) => {
            report.row(
                "Authorization",
                [&source.id, "resource path differs from its receipt binding"],
            );
        }
        None => {
            report.row("Authorization", [receipt, "unknown source receipt"]);
        }
    }
    Some(route)
}

#[cfg(test)]
mod tests {
    use super::*;

    // UTS #46 Table 1 and §5. These expected A-labels come from the standard.
    #[test]
    fn uts46_reference_vectors() {
        for (host, legacy, current) in [
            ("faß.de", "fass.de", "xn--fa-hia.de"),
            ("faẞ.de", "fass.de", "xn--fa-hia.de"),
            ("βόλος.com", "xn--nxasmq6b.com", "xn--nxasmm1c.com"),
            ("ශ්‍රී.com", "xn--10cl1a0b.com", "xn--10cl1a0b660p.com"),
            (
                "نامه‌ای.com",
                "xn--mgba3gch31f.com",
                "xn--mgba3gch31f060k.com",
            ),
            ("faß。de", "fass.de", "xn--fa-hia.de"),
            ("faß．de", "fass.de", "xn--fa-hia.de"),
            ("faß｡de", "fass.de", "xn--fa-hia.de"),
            ("xn--fa-hia.de", "xn--fa-hia.de", "xn--fa-hia.de"),
        ] {
            assert_eq!(ascii(&transitional(host)).unwrap(), legacy);
            assert_eq!(ascii(host).unwrap(), current);
        }
        assert_eq!(ascii(&transitional("a\u{200d}b.test")).unwrap(), "ab.test");
        for host in [
            "xn--.test",
            "a\u{200d}b.test",
            "a\u{200c}b.test",
            "a..test",
            "a_b.test",
        ] {
            assert!(ascii(host).is_err(), "{host}");
        }
    }
}
