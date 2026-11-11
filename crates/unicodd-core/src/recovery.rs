use std::collections::{BTreeMap, BTreeSet};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::{case_fold, international::*, normalize, skeleton, EngineError, ErrorCode, Form};

mod audit;
mod queue;

pub const VERSION: u32 = 1;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Dataset {
    version: u32,
    incident: String,
    revision: String,
    registrations: Vec<Registration>,
    appeals: Vec<Appeal>,
    receipts: Vec<Receipt>,
    identity_probes: Vec<Registration>,
    audit_samples: Vec<audit::Sample>,
    cursors: BTreeMap<String, queue::Cursor>,
    rollback_ready: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Registration {
    id: String,
    owner: String,
    name: String,
    verified: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Appeal {
    id: String,
    title: String,
    registration: String,
    diagnostic: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    id: String,
    registration: String,
    owner: String,
    channel: String,
    verified: bool,
    diagnostic: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Handoff {
    version: u32,
    incident: String,
    revision: String,
    #[serde(flatten)]
    evidence: Evidence,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
enum Evidence {
    Appeals { records: Vec<String> },
    Approvals { approvals: Vec<Approval> },
    Release { identities: Vec<RestoredIdentity> },
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Approval {
    registration: String,
    owner: String,
    receipt: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RestoredIdentity {
    canonical: String,
    name: String,
    approval: Approval,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct Context {
    queue: Vec<String>,
    receipts: BTreeSet<String>,
    plan: Option<Plan>,
    preview: Option<audit::Options>,
    verified: bool,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum IdentityKey {
    Registration,
    Skeleton,
    Name,
    Fold,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum OriginalPolicy {
    Preserve,
    Nfc,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    identity: IdentityKey,
    originals: OriginalPolicy,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum RouteKey {
    Registration,
    DefaultLower,
    TurkishLower,
    Fold,
    Collation,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum CaseProfile {
    Und,
    Tr,
    Az,
    Lt,
    Fold,
}

impl CaseProfile {
    fn map(self, text: &str) -> Result<String, EngineError> {
        Ok(lowercase(
            text,
            match self {
                Self::Und => CaseLocale::Und,
                Self::Tr => CaseLocale::Tr,
                Self::Az => CaseLocale::Az,
                Self::Lt => CaseLocale::Lt,
                Self::Fold => return case_fold(text),
            },
        ))
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Collate,
    Replay,
    Recover,
    Casing,
    Lookup,
    Probe,
    Bind,
    Prepare,
    Preview,
    Verify,
    Commit,
}

impl Operation {
    fn checks(self) -> Vec<&'static str> {
        const PLAN: &[&str] = &[
            "originals",
            "independent-owners",
            "approvals",
            "identity-unique",
        ];
        const AUDIT: &[&str] = &[
            "plan-required",
            "valid-encoding",
            "grapheme-boundary",
            "byte-capacity",
            "bidi-isolation",
            "formatting-controls",
        ];
        match self {
            Self::Collate | Self::Casing => vec![],
            Self::Replay => vec![
                "cursor-profile",
                "no-duplicates",
                "complete-traversal",
                "cursor-unique",
            ],
            Self::Recover => vec!["replay-required", "authentic-appeals"],
            Self::Lookup => vec!["match", "unambiguous"],
            Self::Probe => vec!["routing-unique"],
            Self::Bind => vec![
                "appeal-handoff",
                "receipts-retrieved",
                "consent-single-use",
                "owner-match",
                "routing-unique",
            ],
            Self::Prepare => PLAN.to_vec(),
            Self::Preview => AUDIT.to_vec(),
            Self::Verify | Self::Commit => {
                let mut checks = [PLAN, AUDIT, &["preview-required", "rollback"]].concat();
                if matches!(self, Self::Commit) {
                    checks.extend(["verified", "restored"]);
                }
                checks
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    version: u32,
    pub dataset: Dataset,
    pub command: Operation,
    pub args: Vec<String>,
    #[serde(default)]
    context: Context,
    prior: Option<Handoff>,
    committed: Option<Handoff>,
    #[serde(default)]
    direct: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub solved: bool,
    pub checks: Vec<Check>,
    pub declared_checks: Vec<&'static str>,
    pub rows: Vec<Row>,
    pub context: Context,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handoff: Option<Handoff>,
}

#[derive(Serialize)]
pub struct Check {
    id: &'static str,
    actual: bool,
    expected: bool,
    passed: bool,
}

#[derive(Serialize)]
pub struct Row {
    label: String,
    fields: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    details: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    serialized: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    inspect: Vec<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    audit: bool,
}

impl Report {
    fn new(context: Context, command: Operation) -> Self {
        Self {
            solved: true,
            checks: Vec::new(),
            declared_checks: command.checks(),
            rows: Vec::new(),
            context,
            handoff: None,
        }
    }

    fn check(&mut self, id: &'static str, actual: bool) {
        debug_assert!(self.declared_checks.contains(&id));
        self.solved &= actual;
        self.checks.push(Check {
            id,
            actual,
            expected: true,
            passed: actual,
        });
    }

    fn row(
        &mut self,
        label: impl Into<String>,
        fields: impl IntoIterator<Item = impl AsRef<str>>,
    ) -> &mut Row {
        self.rows.push(Row {
            label: escape_controls(&label.into()),
            fields: fields
                .into_iter()
                .map(|field| escape_controls(field.as_ref()))
                .collect(),
            details: Vec::new(),
            serialized: None,
            inspect: Vec::new(),
            audit: false,
        });
        self.rows.last_mut().expect("inserted row")
    }
}

fn invalid(message: impl Into<String>) -> EngineError {
    EngineError::new(ErrorCode::InvalidProgram, message)
}

fn bad_input(message: impl Into<String>, index: usize) -> EngineError {
    EngineError::new(ErrorCode::InvalidInput, message).at(format!("args.{index}"))
}

fn option<T: DeserializeOwned>(text: &str, index: usize, allowed: &str) -> Result<T, EngineError> {
    serde_json::from_value(serde_json::Value::String(text.into()))
        .map_err(|_| bad_input(format!("Choose {allowed}."), index))
}

fn number(text: &str, index: usize, max: usize) -> Result<usize, EngineError> {
    text.parse()
        .ok()
        .filter(|value| (1..=max).contains(value))
        .ok_or_else(|| bad_input(format!("Enter an integer between 1 and {max}."), index))
}

fn distinct<'a>(values: impl IntoIterator<Item = &'a str>) -> bool {
    let mut seen = BTreeSet::new();
    values.into_iter().all(|value| seen.insert(value))
}

fn identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".-_".contains(&c))
}

pub fn validate_dataset(data: &Dataset) -> Result<(), EngineError> {
    if data.version != VERSION || !identifier(&data.incident) || !identifier(&data.revision) {
        return Err(invalid("Invalid dataset version, incident, or revision."));
    }
    if data.registrations.len() != 2
        || !distinct(data.registrations.iter().map(|r| r.owner.as_str()))
        || !distinct(
            data.registrations
                .iter()
                .chain(&data.identity_probes)
                .map(|r| r.id.as_str()),
        )
        || !data
            .registrations
            .iter()
            .chain(&data.identity_probes)
            .all(|r| {
                identifier(&r.id)
                    && identifier(&r.owner)
                    && r.verified
                    && !r.name.is_empty()
                    && r.name.len() <= 512
            })
    {
        return Err(invalid(
            "Expected two distinct verified registrations and valid identity probes.",
        ));
    }
    if data.appeals.len() > 64
        || data.receipts.len() > 64
        || data.identity_probes.len() > 32
        || !distinct(data.appeals.iter().map(|a| a.id.as_str()))
        || !distinct(data.receipts.iter().map(|r| r.id.as_str()))
        || !data.appeals.iter().all(|a| {
            identifier(&a.id)
                && identifier(&a.registration)
                && !a.title.is_empty()
                && a.title.len() <= 512
                && (a.diagnostic != data.registrations.iter().any(|r| r.id == a.registration))
        })
        || !data.receipts.iter().all(|r| {
            identifier(&r.id)
                && identifier(&r.registration)
                && identifier(&r.owner)
                && !r.channel.is_empty()
                && r.channel.len() <= 512
                && (r.diagnostic != data.registrations.iter().any(|a| a.id == r.registration))
        })
    {
        return Err(invalid("Invalid appeal or receipt records."));
    }
    for registration in &data.registrations {
        if data
            .appeals
            .iter()
            .filter(|a| !a.diagnostic && a.registration == registration.id)
            .count()
            != 1
            || data
                .receipts
                .iter()
                .filter(|r| !r.diagnostic && r.registration == registration.id)
                .count()
                != 1
            || !data.receipts.iter().any(|r| {
                r.registration == registration.id && r.owner == registration.owner && r.verified
            })
        {
            return Err(invalid("Each registration needs one authentic appeal and one verified receipt from its owner."));
        }
    }
    queue::validate_cursors(data)?;
    audit::validate_samples(&data.audit_samples)?;
    Ok(())
}

impl Dataset {
    fn handoff(&self, evidence: Evidence) -> Handoff {
        Handoff {
            version: VERSION,
            incident: self.incident.clone(),
            revision: self.revision.clone(),
            evidence,
        }
    }

    fn authentic_appeals(&self) -> impl Iterator<Item = &Appeal> {
        self.appeals.iter().filter(|appeal| !appeal.diagnostic)
    }

    fn receipt(&self, id: &str) -> Option<&Receipt> {
        self.receipts.iter().find(|r| r.id == id)
    }

    fn valid_appeals(&self, records: &[String]) -> bool {
        records.len() == self.registrations.len()
            && self
                .authentic_appeals()
                .all(|appeal| records.contains(&appeal.id))
    }

    fn valid_approvals(&self, approvals: &[Approval]) -> bool {
        approvals.len() == self.registrations.len()
            && distinct(approvals.iter().map(|a| a.receipt.as_str()))
            && self.registrations.iter().all(|r| {
                approvals.iter().any(|a| {
                    a.registration == r.id
                        && a.owner == r.owner
                        && self.receipt(&a.receipt).is_some_and(|receipt| {
                            receipt.verified
                                && !receipt.diagnostic
                                && receipt.registration == r.id
                                && receipt.owner == r.owner
                        })
                })
            })
    }

    fn prior_evidence<'a>(&self, handoff: Option<&'a Handoff>) -> Option<&'a Evidence> {
        handoff
            .filter(|value| {
                value.version == VERSION
                    && value.incident == self.incident
                    && value.revision == self.revision
            })
            .map(|value| &value.evidence)
    }
}

fn casing(profile: CaseProfile, text: &str, report: &mut Report) -> Result<(), EngineError> {
    let mapped = profile.map(text)?;
    report.row("Original", [text]).inspect.push(text.into());
    report.row("Mapped", [&mapped]).inspect.push(mapped);
    Ok(())
}

fn lookup(
    data: &Dataset,
    profile: CaseProfile,
    channel: &str,
    report: &mut Report,
) -> Result<(), EngineError> {
    let query = profile.map(channel)?;
    report
        .row("Lookup key", [&query])
        .inspect
        .push(query.clone());
    let mut matches = Vec::new();
    for receipt in &data.receipts {
        if profile.map(&receipt.channel)? == query {
            report.row(&receipt.id, [&receipt.registration, &receipt.channel]);
            matches.push(receipt);
        }
    }
    report.check("match", !matches.is_empty());
    report.check("unambiguous", matches.len() <= 1);
    if let [receipt] = matches.as_slice() {
        report.context.receipts.insert(receipt.id.clone());
        report.row("Owner record", [&receipt.owner]);
    }
    Ok(())
}

fn routing_groups(
    data: &Dataset,
    strategy: RouteKey,
) -> Result<BTreeMap<String, Vec<&Receipt>>, EngineError> {
    let mut groups = BTreeMap::<String, Vec<&Receipt>>::new();
    let collation = matches!(strategy, RouteKey::Collation)
        .then(|| collator(SortLocale::English, SortStrength::Primary));
    for receipt in &data.receipts {
        let key = match strategy {
            RouteKey::Registration => receipt.registration.clone(),
            RouteKey::DefaultLower => lowercase(&receipt.channel, CaseLocale::Und),
            RouteKey::TurkishLower => lowercase(&receipt.channel, CaseLocale::Tr),
            RouteKey::Fold => case_fold(&receipt.channel)?,
            RouteKey::Collation => {
                sort_key(collation.as_ref().expect("configured"), &receipt.channel)
                    .iter()
                    .map(|byte| format!("{byte:02X}"))
                    .collect()
            }
        };
        groups.entry(key).or_default().push(receipt);
    }
    Ok(groups)
}

fn routing_audit(
    data: &Dataset,
    strategy: RouteKey,
    report: &mut Report,
) -> Result<(), EngineError> {
    let groups = routing_groups(data, strategy)?;
    for (key, records) in groups.iter().filter(|(_, records)| records.len() > 1) {
        report.row(
            "Routing collision",
            std::iter::once(key.as_str()).chain(records.iter().map(|r| r.id.as_str())),
        );
    }
    report.check("routing-unique", groups.len() == data.receipts.len());
    Ok(())
}

fn bind(
    data: &Dataset,
    strategy: RouteKey,
    ids: [&str; 2],
    prior: Option<&Evidence>,
    direct: bool,
    report: &mut Report,
) -> Result<(), EngineError> {
    report.check(
        "appeal-handoff",
        direct
            || matches!(prior, Some(Evidence::Appeals { records }) if data.valid_appeals(records)),
    );
    report.check(
        "receipts-retrieved",
        ids.iter().all(|id| report.context.receipts.contains(*id)),
    );
    report.check("consent-single-use", ids[0] != ids[1]);
    let approvals: Vec<_> = data
        .registrations
        .iter()
        .zip(ids)
        .map(|(record, id)| Approval {
            registration: record.id.clone(),
            owner: record.owner.clone(),
            receipt: id.into(),
        })
        .collect();
    report.check("owner-match", data.valid_approvals(&approvals));
    routing_audit(data, strategy, report)?;
    if report.solved {
        for approval in &approvals {
            report.row(&approval.registration, [&approval.receipt, &approval.owner]);
        }
        report.handoff = Some(data.handoff(Evidence::Approvals { approvals }));
    }
    Ok(())
}

fn identity_key(record: &Registration, plan: Plan) -> Result<String, EngineError> {
    match plan.identity {
        IdentityKey::Registration => Ok(record.id.clone()),
        IdentityKey::Skeleton => skeleton(&record.name),
        IdentityKey::Name => Ok(record.name.clone()),
        IdentityKey::Fold => case_fold(&record.name),
    }
}

fn plan_audit(
    data: &Dataset,
    plan: Plan,
    prior: Option<&Evidence>,
    direct: bool,
    report: &mut Report,
) -> Result<(), EngineError> {
    let records = || data.registrations.iter().chain(&data.identity_probes);
    let unchanged = match plan.originals {
        OriginalPolicy::Preserve => true,
        OriginalPolicy::Nfc => records()
            .map(|r| normalize(&r.name, Form::NFC).map(|text| text == r.name))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .all(|same| same),
    };
    report.check("originals", unchanged);
    report.check(
        "independent-owners",
        distinct(data.registrations.iter().map(|r| r.owner.as_str())),
    );
    report.check("approvals", direct || matches!(prior, Some(Evidence::Approvals { approvals }) if data.valid_approvals(approvals)));
    let mut keys = BTreeMap::<String, &str>::new();
    let mut unique = true;
    for record in records() {
        let key = identity_key(record, plan)?;
        if let Some(previous) = keys.insert(key.clone(), &record.id) {
            unique = false;
            report.row("Identity collision", [previous, &record.id, &key]);
        }
    }
    report.check("identity-unique", unique);
    Ok(())
}

pub fn run(request: Request) -> Result<Report, EngineError> {
    let Request {
        version,
        dataset: data,
        command,
        args,
        context,
        prior,
        committed,
        direct,
    } = request;
    if version != VERSION {
        return Err(invalid("Unsupported recovery request version."));
    }
    validate_dataset(&data)?;
    if args.iter().enumerate().any(|(index, arg)| {
        let limit = if matches!(command, Operation::Replay) && index == 4 {
            32 * 1024
        } else {
            2048
        };
        arg.len() > limit
    }) {
        return Err(EngineError::new(
            ErrorCode::ResourceLimit,
            "Recovery arguments are limited to 2 KiB each, or 32 KiB for a replay cursor.",
        ));
    }
    let args: Vec<_> = args.iter().map(String::as_str).collect();
    let prior = data.prior_evidence(prior.as_ref());
    let mut report = Report::new(context, command);
    match (command, args.as_slice()) {
        (Operation::Collate, [locale, strength, left, right]) => {
            let collation = collator(queue::locale(locale)?, queue::strength(strength)?);
            report
                .row(
                    "Comparison",
                    [
                        *left,
                        comparison_label(collation.compare(left, right)),
                        *right,
                    ],
                )
                .inspect = vec![left.to_string(), right.to_string()];
            report.row("Collation profile", [COLLATION_PROFILE]);
        }
        (Operation::Replay, [locale, strength, strategy, size, cursor]) => {
            queue::replay(
                &data,
                queue::locale(locale)?,
                queue::strength(strength)?,
                strategy,
                size,
                cursor,
                &mut report,
            )?;
        }
        (Operation::Recover, [first, second]) => {
            let ids = vec![first.to_string(), second.to_string()];
            report.check(
                "replay-required",
                report.context.queue.len() == data.appeals.len()
                    && data
                        .appeals
                        .iter()
                        .all(|appeal| report.context.queue.contains(&appeal.id))
                    && ids.iter().all(|id| report.context.queue.contains(id)),
            );
            report.check("authentic-appeals", data.valid_appeals(&ids));
            if report.solved {
                for appeal in data.authentic_appeals() {
                    report.row(&appeal.id, [&appeal.registration]);
                }
                report.handoff = Some(data.handoff(Evidence::Appeals { records: ids }));
            }
        }
        (Operation::Casing, [locale, label]) => casing(
            option(locale, 0, "und, tr, az, lt, or fold")?,
            label,
            &mut report,
        )?,
        (Operation::Lookup, [locale, label]) => lookup(
            &data,
            option(locale, 0, "und, tr, az, lt, or fold")?,
            label,
            &mut report,
        )?,
        (Operation::Probe, [key]) => routing_audit(&data, route_key(key)?, &mut report)?,
        (Operation::Bind, [key, first, second]) => bind(
            &data,
            route_key(key)?,
            [first, second],
            prior,
            direct,
            &mut report,
        )?,
        (Operation::Prepare, [identity, originals]) => {
            let plan = Plan {
                identity: option(identity, 0, "registration, skeleton, name, or fold")?,
                originals: option(originals, 1, "preserve or nfc")?,
            };
            plan_audit(&data, plan, prior, direct, &mut report)?;
            if report.solved {
                report.context.plan = Some(plan);
                report.context.preview = None;
                report.context.verified = false;
            }
        }
        (Operation::Preview, [units, count, bidi, controls]) => {
            let options = audit::Options::parse(units, count, bidi, controls)?;
            report.check("plan-required", report.context.plan.is_some());
            audit::preview(&data.audit_samples, options, &mut report, true);
            report.context.preview = Some(options);
            report.context.verified = false;
        }
        (Operation::Verify | Operation::Commit, []) => {
            if matches!(command, Operation::Commit) {
                if let Some(Evidence::Release { identities }) =
                    data.prior_evidence(committed.as_ref())
                {
                    report.check("restored", valid_release(&data, identities));
                    if report.solved {
                        release_rows(&data, identities, &mut report);
                    }
                    return Ok(report);
                }
            }
            let plan = report.context.plan;
            let preview = report.context.preview;
            if let (Some(plan), Some(options)) = (plan, preview) {
                plan_audit(&data, plan, prior, direct, &mut report)?;
                audit::preview(&data.audit_samples, options, &mut report, false);
            } else {
                report.check("plan-required", plan.is_some());
                report.check("preview-required", preview.is_some());
            }
            report.check("rollback", data.rollback_ready);
            if matches!(command, Operation::Commit) {
                report.check("verified", report.context.verified);
                if report.solved {
                    let plan = plan.expect("verified plan");
                    let mut identities = Vec::new();
                    for record in &data.registrations {
                        let approval = if let Some(Evidence::Approvals { approvals }) = prior {
                            approvals
                                .iter()
                                .find(|a| a.registration == record.id)
                                .cloned()
                        } else if direct {
                            data.receipts
                                .iter()
                                .find(|r| !r.diagnostic && r.registration == record.id)
                                .map(|r| Approval {
                                    registration: r.registration.clone(),
                                    owner: r.owner.clone(),
                                    receipt: r.id.clone(),
                                })
                        } else {
                            None
                        };
                        if let Some(approval) = approval {
                            identities.push(RestoredIdentity {
                                canonical: identity_key(record, plan)?,
                                name: record.name.clone(),
                                approval,
                            });
                        }
                    }
                    report.check("restored", valid_release(&data, &identities));
                    if report.solved {
                        release_rows(&data, &identities, &mut report);
                        report.handoff = Some(data.handoff(Evidence::Release { identities }));
                    }
                }
            } else {
                report.context.verified = report.solved;
            }
        }
        _ => {
            return Err(bad_input(
                "Incorrect number of operation arguments.",
                args.len(),
            ))
        }
    }
    Ok(report)
}

fn valid_release(data: &Dataset, identities: &[RestoredIdentity]) -> bool {
    distinct(identities.iter().map(|r| r.canonical.as_str()))
        && data.valid_approvals(
            &identities
                .iter()
                .map(|r| r.approval.clone())
                .collect::<Vec<_>>(),
        )
        && identities.iter().all(|r| {
            data.registrations
                .iter()
                .any(|source| source.id == r.approval.registration && source.name == r.name)
        })
}

fn release_rows(data: &Dataset, identities: &[RestoredIdentity], report: &mut Report) {
    report.row(&data.incident, [format!("1 → {}", identities.len())]);
    for identity in identities {
        report
            .row(&identity.approval.registration, [&identity.name])
            .inspect
            .push(identity.name.clone());
    }
}

fn route_key(key: &str) -> Result<RouteKey, EngineError> {
    option(
        key,
        0,
        "registration, default-lower, turkish-lower, fold, or collation",
    )
}
