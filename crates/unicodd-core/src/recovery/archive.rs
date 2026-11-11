use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{
    bad_input, case_fold, distinct, identifier, invalid, normalize, number, option, skeleton,
    valid_release, Dataset, EngineError, Evidence, Form, Operation, Report, RestoredIdentity,
};

mod frames;
mod identifiers;
mod routes;

pub(super) use frames::HexRow;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Archive {
    version: u32,
    pub sources: Vec<Source>,
    endpoints: Vec<routes::Endpoint>,
    frames: Vec<frames::FrameSpec>,
    chunk_edges: Vec<usize>,
    independent: Vec<identifiers::Independent>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Source {
    id: String,
    registration: String,
    owner: String,
    archive_id: String,
    payload: String,
    digest: String,
    endpoint: String,
    path: String,
    status: String,
    ack_marker: String,
    ack_digest: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Release {
    identities: Vec<RestoredIdentity>,
    outbox: Vec<Source>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Dispatch {
    release: Release,
    routes: Vec<routes::Route>,
    capture: Vec<u8>,
    capture_digest: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct Ingestion {
    dispatch: Dispatch,
    frames: Vec<frames::Frame>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Mirror {
    ingestion: Ingestion,
    records: Vec<identifiers::Entry>,
    search_version: String,
    legacy_references: BTreeMap<String, String>,
    legacy_search: BTreeMap<String, Vec<String>>,
    modern_search: BTreeMap<String, Vec<String>>,
}

fn digest(payload: &[u8]) -> String {
    format!("{:x}", Sha256::digest(payload))
}

impl Archive {
    pub(super) fn validate(&self, data: &Dataset) -> Result<(), EngineError> {
        if self.version != 1
            || self.sources.len() != data.registrations.len()
            || self.endpoints.len() != self.sources.len()
            || !distinct(self.endpoints.iter().map(|endpoint| endpoint.host.as_str()))
            || !distinct(self.endpoints.iter().map(|endpoint| endpoint.id.as_str()))
            || !distinct(self.sources.iter().map(|source| source.id.as_str()))
            || !distinct(self.sources.iter().map(|source| source.endpoint.as_str()))
            || self.independent.len() > 24
            || self.frames.len() > 24
        {
            return Err(invalid(
                "Invalid archive fixture version, bounds, or duplicate endpoint or source.",
            ));
        }
        if !self
            .sources
            .iter()
            .zip(&data.registrations)
            .all(|(source, record)| {
                source.registration == record.id
                    && source.owner == record.owner
                    && identifier(&source.id)
                    && identifier(&source.archive_id)
                    && source.status == "QUEUED"
                    && source.payload
                        == format!(
                            "{}|{}|{}|{}",
                            source.id, record.id, record.owner, record.name
                        )
                    && digest(source.payload.as_bytes()) == source.digest
                    && self.endpoints.iter().any(|endpoint| {
                        endpoint.id == source.endpoint
                            && endpoint.owner == source.owner
                            && identifier(&endpoint.id)
                            && routes::canonical_host(&endpoint.host)
                    })
                    && routes::canonical_path(&source.path)
            })
        {
            return Err(invalid("Archive receipt, original payload, or endpoint does not match its verified source."));
        }
        if !self.independent.iter().all(|source| {
            source.verified
                && identifier(&source.id)
                && identifier(&source.registration)
                && identifier(&source.owner)
                && !source.label.is_empty()
                && source.label.len() <= 512
                && digest(source.label.as_bytes()) == source.digest
        }) || !distinct(
            self.sources
                .iter()
                .map(|source| source.archive_id.as_str())
                .chain(self.independent.iter().map(|source| source.id.as_str())),
        ) || !distinct(
            self.sources
                .iter()
                .map(|source| source.registration.as_str())
                .chain(
                    self.independent
                        .iter()
                        .map(|source| source.registration.as_str()),
                ),
        ) || !distinct(
            self.sources
                .iter()
                .map(|source| source.owner.as_str())
                .chain(self.independent.iter().map(|source| source.owner.as_str())),
        ) {
            return Err(invalid(
                "The archive batch needs distinct, verified source IDs, registrations and owners.",
            ));
        }
        if !frames::capture(self, &self.sources)
            .is_some_and(|wire| frames::valid_edges(&self.chunk_edges, wire.len()))
        {
            return Err(invalid(
                "Invalid capture framing, chunk edges, or ACK payload digest.",
            ));
        }
        Ok(())
    }

    fn valid_release(
        &self,
        data: &Dataset,
        identities: &[RestoredIdentity],
        outbox: &[Source],
    ) -> bool {
        outbox == self.sources
            && valid_release(data, identities)
            && identities
                .iter()
                .all(|entry| entry.canonical == entry.approval.registration)
    }

    fn valid_dispatch(&self, data: &Dataset, dispatch: &Dispatch) -> bool {
        self.valid_release(data, &dispatch.release.identities, &dispatch.release.outbox)
            && dispatch.routes.len() == dispatch.release.outbox.len()
            && dispatch
                .release
                .outbox
                .iter()
                .zip(&dispatch.routes)
                .all(|(source, route)| routes::authorized(self, source, route))
            && frames::capture(self, &dispatch.release.outbox).as_ref() == Some(&dispatch.capture)
            && digest(&dispatch.capture) == dispatch.capture_digest
    }
}

pub(super) fn queued_rows(outbox: &[Source], report: &mut Report) {
    for source in outbox {
        report.row(
            "Audit outbox",
            [&source.id, &source.registration, &source.status],
        );
    }
}

pub(super) fn checks(command: Operation) -> &'static [&'static str] {
    match command {
        Operation::Resolve => &["route-authorized"],
        Operation::Dispatch => &[
            "release-required",
            "routing-profile",
            "route-authorized",
            "distinct-endpoints",
        ],
        Operation::Capture => &["dispatch-required", "capture-range"],
        Operation::Deframe => &[
            "dispatch-required",
            "authoritative-bytes",
            "complete-framing",
            "isolated-errors",
            "ack-integrity",
        ],
        Operation::Identifier => &[],
        Operation::Mirror => &[
            "ingestion-required",
            "original-bytes",
            "opaque-labels",
            "legacy-queryable",
            "unique-handles",
            "stable-handles",
            "stable-index",
        ],
        _ => unreachable!("archive operations have their own checks"),
    }
}

fn dispatch(
    data: &Dataset,
    archive: &Archive,
    prior: Option<&Evidence>,
    [profile, first, second]: [&str; 3],
    report: &mut Report,
) -> Result<(), EngineError> {
    let profile = option(profile, 0, "transitional or nontransitional")?;
    let release = match prior {
        Some(Evidence::Release { identities, outbox })
            if archive.valid_release(data, identities, outbox) =>
        {
            Some(Release {
                identities: identities.clone(),
                outbox: outbox.clone(),
            })
        }
        _ => None,
    };
    report.check("release-required", release.is_some());
    report.check(
        "routing-profile",
        profile == routes::Profile::Nontransitional,
    );
    let mut routes = Vec::new();
    for (source, url) in archive.sources.iter().zip([first, second]) {
        report.row(
            "Source receipt",
            [&source.id, &source.registration, &source.digest],
        );
        if let Some(route) = routes::resolve(archive, &source.id, url, profile, report) {
            routes.push(route);
        }
    }
    report.check(
        "route-authorized",
        routes.len() == archive.sources.len()
            && archive
                .sources
                .iter()
                .zip(&routes)
                .all(|(source, route)| routes::authorized(archive, source, route)),
    );
    report.check(
        "distinct-endpoints",
        distinct(routes.iter().map(|route| route.endpoint.as_str())),
    );
    if report.solved {
        let release = release.expect("validated release");
        let capture = frames::capture(archive, &release.outbox).expect("validated capture");
        let capture_digest = digest(&capture);
        report.row(
            "Dispatch confirmed",
            ["Two authorized destinations · application ingestion pending"],
        );
        report.handoff = Some(data.handoff(Evidence::Dispatch {
            evidence: Dispatch {
                release,
                routes,
                capture,
                capture_digest,
            },
        }));
    }
    Ok(())
}

pub(super) fn run(
    data: &Dataset,
    command: Operation,
    args: &[&str],
    prior: Option<&Evidence>,
    committed: Option<&Evidence>,
    report: &mut Report,
) -> Result<(), EngineError> {
    let archive = data
        .archive
        .as_ref()
        .ok_or_else(|| invalid("This operation needs an archive dataset."))?;
    match (command, args) {
        (Operation::Resolve, [profile, receipt, url]) => {
            let profile = option(profile, 0, "transitional or nontransitional")?;
            let route = routes::resolve(archive, receipt, url, profile, report);
            report.check(
                "route-authorized",
                route.as_ref().is_some_and(|route| {
                    archive
                        .sources
                        .iter()
                        .any(|source| routes::authorized(archive, source, route))
                }),
            );
        }
        (Operation::Dispatch, [profile, first, second]) => {
            dispatch(data, archive, prior, [profile, first, second], report)?;
        }
        (Operation::Capture, [offset, count]) => {
            let evidence = accepted_dispatch(archive, data, prior, report);
            if let Some(evidence) = evidence {
                frames::show_capture(archive, evidence, offset, count, report)?;
            }
        }
        (Operation::Deframe, [framing, decoder, errors, integrity, grouping]) => {
            let evidence = accepted_dispatch(archive, data, prior, report);
            if let Some(evidence) = evidence {
                let frames = frames::ingest(
                    archive,
                    evidence,
                    [framing, decoder, errors, integrity, grouping],
                    report,
                )?;
                if report.solved {
                    report.row("Application ingestion", ["Both owner-bound ACKs verified."]);
                    report.handoff = Some(data.handoff(Evidence::Ingestion {
                        evidence: Ingestion {
                            dispatch: evidence.clone(),
                            frames,
                        },
                    }));
                }
            }
        }
        (Operation::Identifier, [version, label]) => identifiers::inspect(version, label, report)?,
        (Operation::Mirror, [storage, handles, version]) => {
            let evidence = match prior {
                Some(Evidence::Ingestion { evidence })
                    if archive.valid_dispatch(data, &evidence.dispatch)
                        && frames::valid_ingestion(&evidence.dispatch, &evidence.frames) =>
                {
                    Some(evidence)
                }
                _ => None,
            };
            report.check("ingestion-required", evidence.is_some());
            if let Some(evidence) = evidence {
                let existing = match committed {
                    Some(Evidence::Mirror { evidence }) => Some(evidence),
                    _ => None,
                };
                if let Some(mirror) = identifiers::mirror(
                    archive,
                    evidence,
                    [storage, handles, version],
                    existing,
                    report,
                )? {
                    report.check(
                        "stable-index",
                        existing.is_none_or(|current| current == &mirror),
                    );
                    if report.solved {
                        report.row(
                            "Archive reconciliation",
                            [format!(
                                "{} verified and queryable records",
                                mirror.records.len()
                            )],
                        );
                        report.handoff = Some(data.handoff(Evidence::Mirror { evidence: mirror }));
                    }
                }
            }
        }
        _ => {
            return Err(bad_input(
                "Incorrect number of operation arguments.",
                args.len(),
            ))
        }
    }
    Ok(())
}

fn accepted_dispatch<'a>(
    archive: &Archive,
    data: &Dataset,
    prior: Option<&'a Evidence>,
    report: &mut Report,
) -> Option<&'a Dispatch> {
    let evidence = match prior {
        Some(Evidence::Dispatch { evidence }) if archive.valid_dispatch(data, evidence) => {
            Some(evidence)
        }
        _ => None,
    };
    report.check("dispatch-required", evidence.is_some());
    evidence
}
